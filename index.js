const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// --- LÓGICA DO ID LUST STORE ---
function gerarIdLust() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let codigo = '';
    for (let i = 0; i < 4; i++) {
        codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `LS-${codigo}`;
}

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// WEBHOOK
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } 
    catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

        if (session.metadata && session.metadata.ids_produtos) {
            const ids = session.metadata.ids_produtos.split(',');
            const codigoPedido = session.metadata.codigo_pedido || 'N/A';
            
            let custoProdutos = 0;
            let itensVendidos = [];

            for (const id of ids) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', id).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                    custoProdutos += (p.preco_entrada || 0);
                    itensVendidos.push({ nome: p.nome, preco: p.preco });
                }
            }
            
            const total = session.amount_total; 
            const frete = session.total_details?.amount_shipping || 0;
            const receitaLiq = (total - frete) / 100;
            const details = session.shipping_details || session.customer_details;
            const addr = details.address;
            const morada = addr ? `${addr.line1}, ${addr.postal_code} ${addr.city}, ${addr.country}` : 'N/A';

            await supabase.from('vendas').insert([{
                cliente_nome: details.name,
                cliente_email: session.customer_details.email,
                cliente_morada: morada,
                itens: itensVendidos,
                codigo_pedido: codigoPedido,
                total_venda: total / 100,
                total_frete: frete / 100,
                total_custo: custoProdutos,
                lucro: receitaLiq - custoProdutos
            }]);
        }
    }
    res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send("API Lust Store: ONLINE 💎"));

// --- NOVA ROTA: BUSCAR DETALHES DO PEDIDO PARA A TELA DE SUCESSO ---
app.get('/pedido/:codigo', async (req, res) => {
    const { codigo } = req.params;
    const { data, error } = await supabase
        .from('vendas')
        .select('cliente_nome, cliente_morada, itens, total_frete, total_venda')
        .eq('codigo_pedido', codigo)
        .single();
        
    if (error || !data) return res.status(404).json({ erro: 'Pedido não encontrado' });
    res.json(data);
});

// --- ROTAS ADMIN ---
app.post('/login-admin', (req, res) => { const { senha } = req.body; if (senha === (process.env.SENHA_ADMIN || 'admin2026')) res.json({ sucesso: true, token: 'logado_sucesso_servidor' }); else res.status(401).json({ sucesso: false }); });
app.get('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true }); res.json(data || []); });
app.post('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').insert([req.body]).select(); res.json(data ? data[0] : null); });
app.put('/produtos/:id', async (req, res) => { const b = {...req.body}; delete b.id; delete b.created_at; const { data } = await supabase.from('produtos').update(b).eq('id', req.params.id).select(); res.json(data ? data[0] : null); });
app.delete('/produtos/:id', async (req, res) => { await supabase.from('produtos').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/vendas', async (req, res) => { const { periodo } = req.query; let q = supabase.from('vendas').select('*').order('data_venda', { ascending: false }); const h = new Date(); h.setHours(0,0,0,0); if(periodo === 'diario') q = q.gte('data_venda', h.toISOString()); else if(periodo === 'mensal') { const m = new Date(); m.setDate(1); m.setHours(0,0,0,0); q = q.gte('data_venda', m.toISOString()); } const { data } = await q; res.json(data || []); });

// --- CHECKOUT ---
app.post('/checkout', async (req, res) => {
    try {
        const itens = req.body;
        const novoIdPedido = gerarIdLust(); 

        let total = 0;
        const line_items = itens.map(i => {
            total += Math.round(i.preco * 100);
            return { price_data: { currency: 'eur', product_data: { name: i.nome }, unit_amount: Math.round(i.preco * 100) }, quantity: 1 };
        });

        const s_options = [
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: total >= 6000 ? 0 : 450, currency: 'eur' }, display_name: 'Portugal: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 4 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 800, currency: 'eur' }, display_name: 'Portugal: Expresso', delivery_estimate: { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 2 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: total >= 8500 ? 0 : 595, currency: 'eur' }, display_name: 'Espanha: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 5 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: total >= 12500 ? 0 : 1250, currency: 'eur' }, display_name: 'Europa: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 10 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 2500, currency: 'eur' }, display_name: 'Europa: Expresso', delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 3 } } } }
        ];

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            shipping_address_collection: { allowed_countries: ['PT', 'ES', 'FR', 'DE', 'IT', 'NL', 'BE', 'LU', 'IE', 'AT'] },
            shipping_options: s_options,
            line_items: line_items,
            mode: 'payment',
            success_url: `https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${novoIdPedido}`,
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
            metadata: { 
                ids_produtos: itens.map(i => i.id).join(','),
                codigo_pedido: novoIdPedido 
            }
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta ${PORT}`));
