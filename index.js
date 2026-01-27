const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// Configuração do Servidor
const app = express();
app.use(express.json());
app.use(cors());

// --- CONEXÃO 1: FINANCEIRO (STRIPE) ---
// Pega a chave do cofre do Render
const stripe = require('stripe')(process.env.STRIPE_KEY);

// --- CONEXÃO 2: BANCO DE DADOS (SUPABASE) ---
// Pega as chaves do cofre do Render
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
//  ROTAS DO GERENTE (CRUD DE PRODUTOS)
// ==========================================

// 1. LISTAR PRODUTOS (Serve tanto para a Loja quanto para o Gerente)
app.get('/produtos', async (req, res) => {
    try {
        // Busca no Supabase ordenando pelo ID
        const { data, error } = await supabase
            .from('produtos')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. CRIAR PRODUTO (Gerente)
app.post('/produtos', async (req, res) => {
    try {
        const novoProduto = req.body;
        const { data, error } = await supabase
            .from('produtos')
            .insert([novoProduto])
            .select(); // Retorna o produto criado

        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. ATUALIZAR PRODUTO (Gerente)
app.put('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const dadosNovos = req.body;
        
        const { data, error } = await supabase
            .from('produtos')
            .update(dadosNovos)
            .eq('id', id);

        if (error) throw error;
        res.json({ message: "Produto atualizado!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. DELETAR PRODUTO (Gerente)
app.delete('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('produtos')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ message: "Produto deletado!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
//  ROTA DA LOJA (PAGAMENTO)
// ==========================================

app.post('/checkout', async (req, res) => {
    try {
        console.log("Iniciando pagamento..."); 
        const itensCarrinho = req.body.itens;

        const line_items = itensCarrinho.map(item => {
            return {
                price_data: {
                    currency: 'eur',
                    product_data: { name: item.nome },
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
        console.error("ERRO NO STRIPE:", error);
        res.status(500).json({ error: error.message });
    }
});

// Inicia o Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Conectado (Stripe + Supabase) na porta ${PORT}`);
});
