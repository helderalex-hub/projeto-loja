const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();

// --- 1. CONFIGURAÇÃO DE CORS (Ajustado para o seu Chrome no Mac) ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// --- 2. WEBHOOK DO STRIPE ---
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        try {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });
            for (const item of lineItems.data) {
                const produtoId = item.price.product.metadata.id_supabase;
                if (produtoId) {
                    const { data: p } = await supabase.from('projeto-loja').select('*').eq('id', produtoId).single();
                    if (p) {
                        await supabase.from('projeto-loja').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', produtoId);
                        // Se quiser registrar vendas em uma tabela separada no futuro, adicione aqui.
                    }
                }
            }
            enviarEmail("✅ VENDA REALIZADA!", `Recebeu €${(session.amount_total/100).toFixed(2)} pelo Stripe.`).catch(e => {});
        } catch (err) { console.error("Erro pós-venda:", err); }
    }
    res.json({ received: true });
});

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false }
});

async function enviarEmail(assunto, texto) {
    try { await transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: assunto, text: texto }); } catch (err) {}
}

// --- 3. ROTAS DA API (APONTANDO PARA projeto-loja) ---

app.get('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('projeto-loja').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json(error);
    res.json(data || []);
});

app.post('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('projeto-loja').insert([req.body]).select();
    if (error) return res.status(400).json(error);
    res.status(201).json(data[0]);
});

app.put('/produtos/:id', async (req, res) => {
    const dadosLimpos = { ...req.body };
    delete dadosLimpos.id;
    delete dadosLimpos.created_at;
    const { data, error } = await supabase.from('projeto-loja').update(dadosLimpos).eq('id', req.params.id).select();
    if (error) return res.status(400).json(error);
    res.json(data[0]);
});

app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('projeto-loja').delete().eq('id', req.params.id);
    res.json({ message: "Eliminado" });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Ativo - Tabela: projeto-loja`));
