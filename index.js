const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// --- 1. CONFIGURAÇÕES INICIAIS ---
app.use(cors());

// Webhook do Stripe (Deve vir antes do express.json)
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

app.use(express.json());

// Iniciar Cliente Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 2. ROTAS DE PRODUTOS ---

// Listar Produtos
app.get('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json(error);
    res.json(data || []);
});

// Criar Novo Produto (POST)
app.post('/produtos', async (req, res) => {
    try {
        const { nome, preco, preco_entrada, estoque, validade, imagem } = req.body;

        const novoProduto = {
            nome: nome,
            preco: parseFloat(preco) || 0,
            preco_entrada: parseFloat(preco_entrada || 0),
            estoque: parseInt(estoque || 0),
            validade: validade && validade !== "" ? validade : null,
            imagem: imagem || ""
        };

        const { data, error } = await supabase
            .from('produtos')
            .insert([novoProduto])
            .select();

        if (error) {
            console.error("Erro no Supabase:", error.message);
            return res.status(400).json({ error: error.message });
        }

        res.status(201).json(data[0]);
    } catch (err) {
        console.error("Erro no Servidor:", err.message);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});

// Atualizar Produto (PUT)
app.put('/produtos/:id', async (req, res) => {
    try {
        const { nome, preco, preco_entrada, estoque, validade, imagem } = req.body;
        
        const { error } = await supabase
            .from('produtos')
            .update({
                nome,
                preco: parseFloat(preco),
                preco_entrada: parseFloat(preco_entrada || 0),
                estoque: parseInt(estoque || 0),
                validade: validade && validade !== "" ? validade : null,
                imagem: imagem || ""
            })
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ message: "Atualizado com sucesso" });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Eliminar Produto
app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').delete().eq('id', req.params.id);
    res.json({ message: "Eliminado" });
});

// --- 3. OUTRAS ROTAS ---

app.get('/vendas', async (req, res) => {
    const { data } = await supabase.from('vendas').select('*').order('id', { ascending: false });
    res.json(data || []);
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

// Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Beleza e Companhia ON na porta ${PORT}`));
