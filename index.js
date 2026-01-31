const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();

// --- 1. CONFIGURAÇÃO DE ACESSO (CORS) ---
// Isto garante que o teu site no GitHub Pages consiga ler a lista de produtos
app.use(cors());

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
                        await supabase.from('vendas').insert([{
                            produto_nome: p.nome, quantidade: 1, valor_pago: p.preco,
                            lucro_real: p.preco - (p.preco_entrada || 0)
                        }]);
                    }
                }
            }
            enviarEmail("✅ NOVA VENDA!", `Valor: €${(session.amount_total/100).toFixed(2)}`).catch(e => {});
        } catch (err) { console.error("Erro pós-venda:", err); }
    }
    res.json({ received: true });
});

// --- 3. MIDDLEWARE JSON (Para o Gerente e Checkout) ---
app.use(express.json());

// --- 4. CONFIGURAÇÃO CLIENTES ---
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
    } catch (err) { console.error("Erro e-mail:", err.message); }
}

// --- 5. ROTAS DA API (COERÊNCIA TOTAL COM O TEU HTML DARK) ---

// LISTAR PRODUTOS (O que preenche a tua lista no Gerente)
app.get('/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CADASTRAR PRODUTO
app.post('/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('produtos').insert([req.body]).select();
        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// EDITAR PRODUTO
app.put('/produtos/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('produtos').update(req.body).eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: "Atualizado" });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ELIMINAR PRODUTO
app.delete('/produtos/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('produtos').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: "Eliminado" });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// CHECKOUT
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

// RELATÓRIO 18:00
cron.schedule('0 18 * * *', async () => {
    try {
        const { data: produtos } = await supabase.from('produtos').select('*');
        const stockBaixo = produtos.filter(p => p.estoque <= 5).map(p => `- ${p.nome}: ${p.estoque}`).join('\n');
        const total = produtos.reduce((acc, p) => acc + (p.preco * p.estoque), 0);
        await enviarEmail("📊 Relatório Diário", `STOCK BAIXO:\n${stockBaixo || 'Nenhum'}\n\nTOTAL EM LOJA: €${total.toFixed(2)}`);
    } catch (err) {}
}, { timezone: "Europe/Lisbon" });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Ativo`));
