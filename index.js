const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// CORS (Permissões)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// WEBHOOK STRIPE (O Coração da Logística)
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

            // 1. Baixar Estoque
            for (const id of ids) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', id).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                    custoTotalVenda += (p.preco_entrada || 0);
                    itensVendidos.push({ nome: p.nome, preco: p.preco });
                }
            }

            // 2. Capturar Morada Completa (Formato Europeu)
            // Prioriza morada de envio, se não existir, usa a de faturação
            const details = session.shipping_details || session.customer_details;
            const addr = details.address;
            
            // Ex: "Rua X, 2 Esq, 1000-001 Lisboa, PT"
            const moradaFormatada = addr ? 
                `${addr.line1}${addr.line2 ? ', ' + addr.line2 : ''}, ${addr.postal_code} ${addr.city}, ${addr.country}` 
                : 'Morada digital / Não fornecida';

            // 3. Registar Venda
            const totalRecebido = session.amount_total / 100;
            await supabase.from('vendas').insert([{
                cliente_nome: details.name,
                cliente_email: session.customer_details.email,
                cliente_morada: moradaFormatada,
                itens: itensVendidos,
                total_venda: totalRecebido,
                total_custo: custoTotalVenda,
                lucro: totalRecebido - custoTotalVenda
            }]);
        }
    }
    res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send("API Beleza & Cia: ONLINE ✅"));

// Login Admin
app.post('/login-admin', (req, res) => {
    const { senha } = req.body;
    const senhaCorreta = process.env.SENHA_ADMIN || 'admin2026';
    if (senha === senhaCorreta) res.json({ sucesso: true, token: 'logado_sucesso_servidor' });
    else res.status(401).json({ sucesso: false });
});

// CRUD Produtos
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

// Relatórios
app.get('/vendas', async (req, res) => {
    const { periodo } = req.query;
    let query = supabase.from('vendas').select('*').order('data_venda', { ascending: false });
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    
    if (periodo === 'diario') query = query.gte('data_venda', hoje.toISOString());
    else if (periodo === 'semanal') { const s = new Date(); s.setDate(hoje.getDate()-7); query = query.gte('data_venda', s.toISOString()); }
    else if (periodo === 'mensal') { const m = new Date(); m.setDate(1); m.setHours(0,0,0,0); query = query.gte('data_venda', m.toISOString()); }
    
    const { data, error } = await query;
    if (error) return res.status(500).json(error);
    res.json(data || []);
});

// Checkout (Atualizado para exigir morada de envio)
app.post('/checkout', async (req, res) => {
    try {
        const itens = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            
            // OBRIGA A RECOLHA DE MORADA DE ENVIO (IMPORTANTE PARA LOGÍSTICA)
            shipping_address_collection: {
                allowed_countries: ['PT', 'ES', 'FR', 'DE', 'CH', 'GB', 'BR'], // Adicione países conforme necessário
            },
            
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor na porta ${PORT}`));
