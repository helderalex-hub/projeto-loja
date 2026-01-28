const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// --- 1. ROTA DO WEBHOOK (O TELEFONE VERMELHO) ---
// Esta rota precisa vir ANTES das configurações normais
// Ela recebe o aviso do Stripe e verifica a assinatura de segurança
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Verifica se o aviso veio mesmo do Stripe usando a chave que você salvou no Render
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`⚠️ Erro de Webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Se o evento for "Compra Concluída com Sucesso"
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log("💰 Pagamento aprovado! Sessão:", session.id);

        // Pede ao Stripe a lista do que foi comprado nessa sessão
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
            expand: ['data.price.product'],
        });

        // Para cada item comprado, baixa o estoque
        for (const item of lineItems.data) {
            // Recupera o ID do produto que escondemos na hora do checkout
            const produtoId = item.price.product.metadata.id_supabase;
            
            if (produtoId) {
                await baixarEstoque(produtoId);
            }
        }
    }

    res.send(); // Responde "OK" para o Stripe
});

// --- FUNÇÃO PARA BAIXAR ESTOQUE ---
async function baixarEstoque(id) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // 1. Pega o estoque atual
    const { data: produto } = await supabase
        .from('produtos')
        .select('estoque')
        .eq('id', id)
        .single();

    if (produto) {
        const novoEstoque = produto.estoque - 1;
        // 2. Salva o novo estoque
        await supabase
            .from('produtos')
            .update({ estoque: novoEstoque })
            .eq('id', id);
        console.log(`📉 Produto ${id}: Estoque baixou para ${novoEstoque}`);
    }
}

// --- CONFIGURAÇÕES PADRÃO ---
app.use(express.json());
app.use(cors());

// Conexão Supabase Geral
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- ROTAS DO SITE (PRODUTOS) ---

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

// --- ROTA DE CHECKOUT (ATUALIZADA) ---
app.post('/checkout', async (req, res) => {
    try {
        const itensCarrinho = req.body.itens;
        const line_items = itensCarrinho.map(item => {
            return {
                price_data: {
                    currency: 'eur',
                    product_data: { 
                        name: item.nome,
                        // AQUI ESTÁ O SEGREDO: Escondemos o ID do produto aqui
                        metadata: { 
                            id_supabase: item.id 
                        }
                    },
                    unit_amount: Math.round(item.preco * 100), 
                },
                quantity: 1,
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
    console.log(`Servidor rodando na porta ${PORT}`);
});
