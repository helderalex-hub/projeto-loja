const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// Configurações essenciais
app.use(cors());
// IMPORTANTE: O Webhook precisa do corpo "raw" ANTES do express.json()
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
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });

        for (const item of lineItems.data) {
            const produtoId = item.price.product.metadata.id_supabase;
            if (produtoId) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', produtoId).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: p.estoque - 1 }).eq('id', produtoId);
                    await supabase.from('vendas').insert([{
                        produto_nome: p.nome,
                        quantidade: 1,
                        valor_pago: p.preco,
                        lucro_real: p.preco - (p.preco_entrada || 0)
                    }]);
                }
            }
        }
    }
    res.send();
});

// Middleware para as outras rotas
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- ROTAS DE PRODUTOS ---

app.get('/produtos', async (req, res) => {
    const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    res.json(data);
});

app.post('/produtos', async (req, res) => {
    const { nome, preco, preco_entrada, estoque, imagem } = req.body;
    const { data, error } = await supabase.from('produtos').insert([{
        nome,
        preco: parseFloat(preco),
        preco_entrada: parseFloat(preco_entrada || 0),
        estoque: parseInt(estoque || 0),
        imagem
    }]).select();
    
    if (error) return res.status(400).json(error);
    res.status(201).json(data[0]);
});

app.put('/produtos/:id', async (req, res) => {
    const { nome, preco, preco_entrada, estoque, imagem } = req.body;
    const { error } = await supabase.from('produtos').update({
        nome,
        preco: parseFloat(preco),
        preco_entrada: parseFloat(preco_entrada || 0),
        estoque: parseInt(estoque || 0),
        imagem
    }).eq('id', req.params.id);

    if (error) return res.status(400).json(error);
    res.json({ message: "Atualizado" });
});

app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').delete().eq('id', req.params.id);
    res.json({ message: "Deletado" });
});

app.get('/vendas', async (req, res) => {
    const { data } = await supabase.from('vendas').select('*').order('id', { ascending: false });
    res.json(data);
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
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/',
        });
        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Beleza e Companhia rodando!`));
