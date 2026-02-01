const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// --- WEBHOOK STRIPE (Regista Venda e Baixa Stock) ---
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
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

        if (session.metadata && session.metadata.ids_produtos) {
            const ids = session.metadata.ids_produtos.split(',');
            let custoTotalVenda = 0;
            let itensVendidos = [];

            for (const id of ids) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', id).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                    custoTotalVenda += (p.preco_entrada || 0);
                    itensVendidos.push({ nome: p.nome, preco: p.preco });
                }
            }

            const totalRecebido = session.amount_total / 100;
            await supabase.from('vendas').insert([{
                cliente_nome: session.customer_details.name,
                cliente_email: session.customer_details.email,
                cliente_morada: session.customer_details.address ? 
                    `${session.customer_details.address.line1}, ${session.customer_details.address.city}` : 'N/A',
                itens: itensVendidos,
                total_venda: totalRecebido,
                total_custo: custoTotalVenda,
                lucro: totalRecebido - custoTotalVenda
            }]);
        }
    }
    res.json({ received: true });
});

app.use(express.json());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Rota de Login
app.post('/login-admin', (req, res) => {
    const { senha } = req.body;
    const senhaCorreta = process.env.SENHA_ADMIN || 'admin2026';
    if (senha === senhaCorreta) res.json({ sucesso: true, token: 'logado_sucesso_servidor' });
    else res.status(401).json({ sucesso: false });
});

// Rotas de Produtos
app.get('/produtos', async (req, res) => {
    const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    res.json(data || []);
});

app.post('/produtos', async (req, res) => {
    const { data } = await supabase.from('produtos').insert([req.body]).select();
    res.json(data ? data[0] : null);
});

app.put('/produtos/:id', async (req, res) => {
    const b = {...req.body}; delete b.id; delete b.created_at;
    const { data } = await supabase.from('produtos').update(b).eq('id', req.params.id).select();
    res.json(data ? data[0] : null);
});

app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').delete().eq('id', req.params.id);
    res.json({ success: true });
});

// --- ROTA DE VENDAS COM FILTRO DE PERÍODO ---
app.get('/vendas', async (req, res) => {
    const { periodo } = req.query;
    let query = supabase.from('vendas').select('*').order('data_venda', { ascending: false });
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (periodo === 'diario') {
        query = query.gte('data_venda', hoje.toISOString());
    } else if (periodo === 'semanal') {
        const semana = new Date();
        semana.setDate(hoje.getDate() - 7);
        query = query.gte('data_venda', semana.toISOString());
    } else if (periodo === 'mensal') {
        const mes = new Date();
        mes.setDate(1); mes.setHours(0,0,0,0);
        query = query.gte('data_venda', mes.toISOString());
    }

    const { data, error } = await query;
    if (error) return res.status(500).json(error);
    res.json(data || []);
});

// Checkout
app.post('/checkout', async (req, res) => {
    try {
        const itens = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            billing_address_collection: 'required',
            line_items: itens.map(item => ({
                price_data: {
                    currency: 'eur',
                    product_data: { name: item.nome },
                    unit_amount: Math.round(item.preco * 100),
                },
                quantity: 1,
            })),
            mode: 'payment',
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
            metadata: { ids_produtos: itens.map(i => i.id).join(',') }
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000);
