const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const cors = require('cors'); // Vamos usar cors nativo para facilitar, ou manual abaixo

const app = express();

// --- 1. CONFIGURAÇÃO DE SEGURANÇA (CORS) ---
// Permite que tanto o Admin quanto a Loja falem com o servidor
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// --- 2. WEBHOOK STRIPE (Baixa de Estoque Automática) ---
// Deve vir ANTES do express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        // Aqui futuramente salvaremos a venda no histórico
        if (session.metadata && session.metadata.ids_produtos) {
            const ids = session.metadata.ids_produtos.split(',');
            // Loop simples para baixar estoque
            for (const id of ids) {
                // Nota: Isto baixa 1 unidade por produto distinto no carrinho
                const { data: p } = await supabase.from('produtos').select('estoque').eq('id', id).single();
                if(p) {
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                }
            }
        }
    }
    res.json({ received: true });
});

app.use(express.json());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 3. ROTAS DO ADMIN (Mantidas) ---
app.get('/', (req, res) => res.send('🚀 Servidor Vendas & Admin ON'));

app.get('/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
        if (error) throw error;
        res.status(200).json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').insert([req.body]).select();
    res.json(data ? data[0] : {error});
});

app.put('/produtos/:id', async (req, res) => {
    const b = {...req.body}; delete b.id; delete b.created_at;
    const { data, error } = await supabase.from('produtos').update(b).eq('id', req.params.id).select();
    res.json(data ? data[0] : {error});
});

app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').delete().eq('id', req.params.id);
    res.json({ success: true });
});

// --- 4. ROTA DE CHECKOUT (O que faltava!) ---
app.post('/checkout', async (req, res) => {
    try {
        const itens = req.body; // Recebe o carrinho da loja
        
        // Cria os itens para o Stripe
        const line_items = itens.map(item => ({
            price_data: {
                currency: 'eur',
                product_data: { 
                    name: item.nome, 
                    images: item.imagem ? [item.imagem] : [],
                },
                unit_amount: Math.round(item.preco * 100), // Stripe usa cêntimos
            },
            quantity: item.quantidade || 1,
        }));

        // Cria a sessão de pagamento
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items,
            mode: 'payment',
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
            metadata: {
                // Guardamos os IDs para dar baixa no estoque depois
                ids_produtos: itens.map(i => i.id).join(',')
            }
        });

        res.json({ url: session.url });
    } catch (e) {
        console.error("Erro no checkout:", e);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Pronto: ${PORT}`));
