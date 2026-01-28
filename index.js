const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// --- ROTA DO WEBHOOK (COM SUPER LOGS) ---
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`⚠️ Erro de Assinatura: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log("💰 Pagamento aprovado! ID da Sessão:", session.id);

        try {
            // Pede ao Stripe a lista expandida
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
                expand: ['data.price.product'],
            });

            console.log(`📦 Quantidade de itens no pedido: ${lineItems.data.length}`);

            for (const item of lineItems.data) {
                // LOG IMPORTANTE: Vamos ver o que o Stripe mandou
                const produtoStripe = item.price.product;
                const quantidadeComprada = item.quantity;
                console.log(`🔍 Analisando item: ${produtoStripe.name}`);
                console.log(`   - Metadata encontrada:`, produtoStripe.metadata);
                console.log(`   - Quantidade comprada: ${quantidadeComprada}`);

                const produtoId = produtoStripe.metadata.id_supabase;
                
                if (produtoId) {
                    await baixarEstoque(produtoId, quantidadeComprada);
                } else {
                    console.log("⚠️ ALERTA: Este produto não tem 'id_supabase' na metadata. O estoque não será baixado.");
                }
            }
        } catch (erroInterno) {
            console.error("❌ Erro ao processar itens:", erroInterno.message);
        }
    }

    res.send();
});

// --- FUNÇÃO PARA BAIXAR ESTOQUE (CORRIGIDA PARA QUANTIDADE) ---
async function baixarEstoque(id, quantidade) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    console.log(`📉 Tentando baixar ${quantidade} unidades do produto ID ${id}...`);

    const { data: produto, error } = await supabase
        .from('produtos')
        .select('estoque')
        .eq('id', id)
        .single();

    if (error) {
        console.log("❌ Erro ao buscar no banco:", error.message);
        return;
    }

    if (produto) {
        const novoEstoque = produto.estoque - quantidade;
        const { error: erroUpdate } = await supabase
            .from('produtos')
            .update({ estoque: novoEstoque })
            .eq('id', id);

        if (!erroUpdate) {
            console.log(`✅ SUCESSO! Estoque atualizado para ${novoEstoque}`);
        } else {
            console.log("❌ Erro ao salvar novo estoque:", erroUpdate.message);
        }
    }
}

// --- CONFIGURAÇÕES PADRÃO ---
app.use(express.json());
app.use(cors());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- ROTAS NORMAIS ---
app.get('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').insert([req.body]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
});

app.put('/produtos/:id', async (req, res) => {
    const { error } = await supabase.from('produtos').update(req.body).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Atualizado" });
});

app.delete('/produtos/:id', async (req, res) => {
    const { error } = await supabase.from('produtos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Deletado" });
});

// --- CHECKOUT ---
app.post('/checkout', async (req, res) => {
    try {
        const itensCarrinho = req.body.itens;
        const line_items = itensCarrinho.map(item => {
            return {
                price_data: {
                    currency: 'eur',
                    product_data: { 
                        name: item.nome,
                        metadata: { 
                            id_supabase: item.id // O ID precisa estar aqui!
                        }
                    },
                    unit_amount: Math.round(item.preco * 100), 
                },
                quantity: 1, // Nota: Se o carrinho agrupar quantidades, isso precisa mudar no frontend depois. Por enquanto assume 1 por linha.
            };
        });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: line_items,
            mode: 'payment',
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
        });

        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor DETETIVE rodando na porta ${PORT}`);
});
