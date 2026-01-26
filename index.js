const express = require('express');
const cors = require('cors');
const app = express();
// Importa o Stripe usando a chave que guardamos no Render
const stripe = require('stripe')(process.env.STRIPE_KEY);

app.use(express.json());
app.use(cors());

// Seus produtos (Banco de Dados simples)
let produtos = [
    { id: 1, nome: 'Batom Vermelho', preco: 50.00, estoque: 10, validade: '2026-12-30' },
    { id: 2, nome: 'Creme Hidratante', preco: 85.50, estoque: 5, validade: '2025-11-20' },
    { id: 3, nome: 'Perfume Floral', preco: 120.00, estoque: 2, validade: '2027-01-15' }
];

// Rota 1: Listar Produtos
app.get('/produtos', (req, res) => {
    res.json(produtos);
});

// Rota 2: Criar Pagamento (CHECKOUT)
app.post('/checkout', async (req, res) => {
    try {
        const itensCarrinho = req.body.itens; // Recebe a lista do frontend

        // Formata os itens para o Stripe entender
        const line_items = itensCarrinho.map(item => {
            return {
                price_data: {
                    currency: 'eur', // Moeda (Euro)
                    product_data: {
                        name: item.nome,
                    },
                    unit_amount: Math.round(item.preco * 100), // Stripe usa centavos (50.00 vira 5000)
                },
                quantity: 1,
            };
        });

        // Cria a sessão de pagamento no Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'], // Aceita cartão
            line_items: line_items,
            mode: 'payment',
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
        });

        // Manda o link de pagamento de volta para o cliente
        res.json({ url: session.url });

    } catch (error) {
        console.error("Erro no pagamento:", error);
        res.status(500).json({ error: "Erro ao criar pagamento" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});