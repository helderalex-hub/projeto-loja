const express = require('express');
const cors = require('cors'); // Mantemos aqui por precaução
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();

// --- 1. AJUSTE MANUAL DE SEGURANÇA (CORS) ---
// Este bloco substitui o cors() padrão e força a autorização
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*"); 
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    
    // Essencial para o Chrome: responde ao pedido de "pré-verificação" (OPTIONS)
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

// --- 2. ROTA WEBHOOK (Deve vir antes do express.json) ---
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        try {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });
            for (const item of lineItems.data) {
                const produtoId = item.price.product.metadata.id_supabase;
                if (produtoId) {
                    const { data: p } = await supabase.from('produtos').select('*').eq('id', produtoId).single();
                    if (p) {
                        await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', produtoId);
                        // Registro de venda
                        await supabase.from('vendas').insert([{
                            produto_nome: p.nome,
                            quantidade: 1,
                            valor_pago: p.preco,
                            lucro_real: p.preco - (p.preco_entrada || 0)
                        }]).catch(() => {}); // Ignora erro se a tabela vendas não existir
                    }
                }
            }
            enviarEmail("✅ VENDA REALIZADA!", `Recebeu um pagamento de €${(session.amount_total/100).toFixed(2)}`).catch(e => {});
        } catch (err) { console.error("Erro pós-venda:", err); }
    }
    res.json({ received: true });
});

// --- 3. MIDDLEWARE PARA JSON ---
app.use(express.json());

// --- 4. CLIENTES E CONFIGURAÇÕES ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false }
});

async function enviarEmail(assunto, texto) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: assunto,
            text: texto
        });
    } catch (err) { console.error("Erro email:", err.message); }
}

// --- 5. ROTAS DA API (Tabela: produtos) ---

app.get('/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('produtos').insert([req.body]).select();
        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/produtos/:id', async (req, res) => {
    try {
        const dadosAtualizar = { ...req.body };
        delete dadosAtualizar.id;
        delete dadosAtualizar.created_at;

        const { data, error } = await supabase.from('produtos').update(dadosAtualizar).eq('id', req.params.id).select();
        if (error) throw error;
        res.json(data[0]);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/produtos/:id', async (req, res) => {
    try {
        await supabase.from('produtos').delete().eq('id', req.params.id);
        res.json({ message: "OK" });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/checkout', async (req, res) => {
    try {
        const line_items = req.body.itens.map(item => ({
            price_data: {
                currency: 'eur',
                product_data: { name: item.nome, metadata: { id_supabase: item.id } },
                unit_amount: Math.round(item.preco * 100),
            },
            quantity: 1,
        }));
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items,
            mode: 'payment',
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
        });
        res.json({ url: session.url });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- 6. CRON RELATÓRIO 18:00 ---
cron.schedule('0 18 * * *', async () => {
    try {
        const { data: produtos } = await supabase.from('produtos').select('*');
        const stockBaixo = produtos.filter(p => p.estoque <= 5).map(p => `- ${p.nome}: ${p.estoque}`).join('\n');
        const total = produtos.reduce((acc, p) => acc + (p.preco * p.estoque), 0);
        await enviarEmail("📊 Relatório Stock", `BAIXO STOCK:\n${stockBaixo || 'Nada'}\n\nTOTAL PVP: €${total.toFixed(2)}`);
    } catch (err) {}
}, { timezone: "Europe/Lisbon" });

// --- 7. START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
