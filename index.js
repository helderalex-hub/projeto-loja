const express = require('express');
const cors = require('cors');
const app = express();

// 🔐 SEGURANÇA MÁXIMA: 
// O código agora busca a chave nas Variáveis do Render (Environment Variables).
// Certifique-se que o nome da chave no Render é exatamente 'STRIPE_KEY'
const stripe = require('stripe')(process.env.STRIPE_KEY);

app.use(express.json());
app.use(cors());

// --- BANCO DE DADOS SIMPLIFICADO (Para teste do Pagamento) ---
// Em breve podemos reconectar ao Supabase se você quiser.
let produtos = [
    { id: 1, nome: 'Batom Vermelho', preco: 50.00, estoque: 10, validade: '2026-12-30' },
    { id: 2, nome: 'Creme Hidratante', preco: 85.50, estoque: 5, validade: '2025-11-20' },
    { id: 3, nome: 'Perfume Floral', preco: 120.00, estoque: 2, validade: '2027-01-15' }
];

// Rota 1: Listar Produtos (Para a Loja e Gerente)
app.get('/produtos', (req, res) => {
    res.json(produtos);
});

// Rota 2: Criar Pagamento (CHECKOUT COM STRIPE)
app.post('/checkout', async (req, res) => {
    try {
        console.log("Iniciando pagamento..."); 
        
        // Recebe o carrinho que veio do site
        const itensCarrinho = req.body.itens;

        // Formata os produtos para o padrão do Stripe
        const line_items = itensCarrinho.map(item => {
            return {
                price_data: {
                    currency: 'eur', // Moeda: Euro
                    product_data: {
                        name: item.nome,
                    },
                    // O Stripe trabalha com centavos (Ex: 50.00 vira 5000)
                    unit_amount: Math.round(item.preco * 100), 
                },
                quantity: 1,
            };
        });

        // Cria a sessão de pagamento no Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: line_items,
            mode: 'payment',
            // Onde o cliente vai parar se der certo:
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            // Onde o cliente vai parar se ele desistir no meio:
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
        });

        console.log("Sessão criada com sucesso:", session.url);
        
        // Devolve o link seguro para o site
        res.json({ url: session.url });

    } catch (error) {
        console.error("ERRO CRÍTICO NO STRIPE:", error);
        // Devolve o erro para o site saber o que houve
        res.status(500).json({ error: "Erro ao criar pagamento: " + error.message });
    }
});

// Porta do Servidor (Padrão do Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor seguro rodando na porta ${PORT}`);
});