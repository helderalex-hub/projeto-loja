const express = require('express');
const cors = require('cors');
const app = express();

// 🔐 O código busca a chave no Render (Environment Variables)
const stripe = require('stripe')(process.env.STRIPE_KEY);

app.use(express.json());
app.use(cors());

// Seus produtos
let produtos = [
    { id: 1, nome: 'Batom Vermelho', preco: 50.00, estoque: 10, validade: '2026-12-30' },
    { id: 2, nome: 'Creme Hidratante', preco: 85.50, estoque: 5, validade: '2025-11-20' },
    { id: 3, nome: 'Perfume Floral', preco: 120.00, estoque: 2, validade: '2027-01-15' }
];

app.get('/produtos', (req, res) => {
    res.json(produtos);
});

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
        console.error("ERRO:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor seguro rodando na porta ${PORT}`);
});
