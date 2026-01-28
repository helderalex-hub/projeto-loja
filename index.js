const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// --- 1. ROTA DO WEBHOOK (RECEBE O AVISO DE VENDA) ---
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
        console.log("💰 WEBHOOK: Pagamento aprovado! ID:", session.id);

        try {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
                expand: ['data.price.product'],
            });

            for (const item of lineItems.data) {
                const produtoStripe = item.price.product;
                // Tenta pegar o ID de dois lugares possíveis para garantir
                const produtoId = produtoStripe.metadata.id_supabase || session.metadata.id_unico_teste;
                
                console.log(`🔍 WEBHOOK: Analisando item '${produtoStripe.name}'`);
                console.log(`   - Metadata recebida:`, produtoStripe.metadata);

                if (produtoId) {
                    await baixarEstoque(produtoId);
                } else {
                    console.log("❌ ERRO CRÍTICO: O ID do Supabase não chegou aqui. O checkout não enviou.");
                }
            }
        } catch (erroInterno) {
            console.error("❌ Erro no processamento:", erroInterno.message);
        }
    }

    res.send();
});

// --- FUNÇÃO PARA BAIXAR ESTOQUE ---
async function baixarEstoque(id) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log(`📉 SUPABASE: Baixando estoque do ID ${id}...`);

    const { data: produto } = await supabase.from('produtos').select('estoque').eq('id', id).single();

    if (produto) {
        const novoEstoque = produto.estoque - 1;
        await supabase.from('produtos').update({ estoque: novoEstoque }).eq('id', id);
        console.log(`✅ SUCESSO! Estoque atualizado para ${novoEstoque}`);
    }
}

// --- CONFIGURAÇÕES GERAIS ---
app.use(express.json());
app.use(cors());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- ROTAS DE PRODUTOS ---
app.get('/produtos', async (req, res) => {
    const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    res.json(data);
});

app.post('/produtos', async (req, res) => {
    const { data } = await supabase.from('produtos').insert([req.body]).select();
    res.status(201).json(data[0]);
});

app.put('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').update(req.body).eq('id', req.params.id);
    res.json({ message: "Atualizado" });
});

app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').delete().eq('id', req.params.id);
    res.json({ message: "Deletado" });
});

// --- ROTA DE CHECKOUT (AQUI ESTÁ O FOCO DO TESTE) ---
app.post('/checkout', async (req, res) => {
    try {
        const itensCarrinho = req.body.itens;
        
        // LOG DETETIVE: O que o Frontend mandou?
        console.log("🛒 CHECKOUT: Recebi pedido com", itensCarrinho.length, "itens.");
        
        const line_items = itensCarrinho.map(item => {
            console.log(`   - Processando item: ${item.nome} | ID: ${item.id}`);
            
            if (!item.id) {
                console.log("   ❌ PERIGO: Este item está sem ID!");
            }

            return {
                price_data: {
                    currency: 'eur',
                    product_data: { 
                        name: item.nome,
                        metadata: { 
                            id_supabase: item.id // <--- O ID TEM QUE ESTAR AQUI
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
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/',
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("❌ Erro no Checkout:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Detetive V2 rodando na porta ${PORT}`);
});
