const express = require('express');
const cors = require('cors');
const app = express();

// AQUI ESTÁ A MUDANÇA: A chave está direto no código
const stripe = require('stripe')('rk_test_51Stulm1dcl8yMmUedgPOAsvwN0d6dYinMNQHDKJ8n1Et8zh05UaIDqtGJjM62bdJmAsQ5N0H8R670tj2vdXbLQgA00MbyiiWrv');

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
        console.log("Recebi pedido de checkout!"); // Log para debug
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

        console.log("Sessão criada:", session.url);
        res.json({ url: session.url });

    } catch (error) {
        console.error("ERRO NO STRIPE:", error); // Isso vai aparecer no Log do Render
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
