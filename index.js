const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();

// --- 1. CONFIGURAÇÕES INICIAIS ---
app.use(cors());

// --- 2. ROTA WEBHOOK (Prioridade Máxima - Deve vir antes do express.json) ---
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
        console.log("💳 Pagamento Confirmado! Processando stock e lucro...");

        try {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });
            
            for (const item of lineItems.data) {
                const produtoId = item.price.product.metadata.id_supabase;
                if (produtoId) {
                    // Busca produto atual no Supabase
                    const { data: p } = await supabase.from('produtos').select('*').eq('id', produtoId).single();
                    
                    if (p) {
                        // 1. Baixa o Stock
                        await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', produtoId);
                        
                        // 2. Regista Venda com Lucro Real
                        await supabase.from('vendas').insert([{
                            produto_nome: p.nome,
                            quantidade: 1,
                            valor_pago: p.preco,
                            lucro_real: p.preco - (p.preco_entrada || 0)
                        }]);
                    }
                }
            }
            // Notificação por E-mail
            enviarEmail("✅ VENDA REALIZADA!", `Nova venda de €${(session.amount_total/100).toFixed(2)} processada. O stock foi atualizado automaticamente.`).catch(e => {});
            
        } catch (err) {
            console.error("Erro no processamento pós-venda:", err);
        }
    }
    res.json({ received: true });
});

// --- 3. MIDDLEWARE JSON (Ativação para o Painel ADM e Checkout) ---
app.use(express.json());

// --- 4. CONFIGURAÇÃO DE CLIENTES (Supabase & E-mail) ---
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
        console.log("📧 E-mail enviado com sucesso.");
    } catch (err) {
        console.error("❌ Erro e-mail:", err.message);
    }
}

// --- 5. ROTAS DA API (Sincronizadas com adm.html) ---

// LISTAR PRODUTOS (PVP, Custo e Imagens)
app.get('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json(error);
    res.json(data || []);
});

// CADASTRAR PRODUTO
app.post('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').insert([req.body]).select();
    if (error) return res.status(400).json(error);
    res.status(201).json(data[0]);
});

// EDITAR PRODUTO (Blindado para o ADM)
app.put('/produtos/:id', async (req, res) => {
    const dadosLimpos = { ...req.body };
    
    // Remove chaves primárias e metadados para não dar erro no Supabase
    delete dadosLimpos.id;
    delete dadosLimpos.created_at;

    const { data, error } = await supabase
        .from('produtos')
        .update(dadosLimpos)
        .eq('id', req.params.id)
        .select();

    if (error) {
        console.error("Erro Supabase:", error.message);
        return res.status(400).json(error);
    }
    res.json(data[0]);
});

// ELIMINAR PRODUTO
app.delete('/produtos/:id', async (req, res) => {
    const { error } = await supabase.from('produtos').delete().eq('id', req.params.id);
    if (error) return res.status(400).json(error);
    res.json({ message: "Eliminado" });
});

// CHECKOUT STRIPE
app.post('/checkout', async (req, res) => {
    try {
        const line_items = req.body.itens.map(item => ({
            price_data: {
                currency: 'eur',
                product_data: { 
                    name: item.nome, 
                    metadata: { id_supabase: item.id } 
                },
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
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 6. RELATÓRIO DIÁRIO (18:00 LISBOA) ---
cron.schedule('0 18 * * *', async () => {
    try {
        const { data: produtos } = await supabase.from('produtos').select('*');
        const stockBaixo = produtos.filter(p => p.estoque <= 5).map(p => `- ${p.nome}: ${p.estoque}`).join('\n');
        const totalVenda = produtos.reduce((acc, p) => acc + (p.preco * p.estoque), 0);

        const texto = `📊 RELATÓRIO DE STOCK\n\n` +
                      `⚠️ STOCK BAIXO (≤5):\n${stockBaixo || 'Nenhum item em falta'}\n\n` +
                      `💰 VALOR TOTAL (PVP): €${totalVenda.toFixed(2)}\n\n` +
                      `Equipa Beleza & Cia.`;

        await enviarEmail("📊 Relatório de Inventário Diário
