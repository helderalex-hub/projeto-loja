const express = require('express');
const cors = require('cors');
const app = express();

<<<<<<< HEAD
// 🔐 SEGURANÇA MÁXIMA: 
// O código agora busca a chave nas Variáveis do Render (Environment Variables).
// Certifique-se que o nome da chave no Render é exatamente 'STRIPE_KEY'
const stripe = require('stripe')(process.env.STRIPE_KEY);
=======
// AQUI ESTÁ A MUDANÇA: A chave está direto no código
const stripe = require('stripe')('rk_test_51Stulm1dcl8yMmUedgPOAsvwN0d6dYinMNQHDKJ8n1Et8zh05UaIDqtGJjM62bdJmAsQ5N0H8R670tj2vdXbLQgA00MbyiiWrv');
>>>>>>> c9c989709261ea527186a7017eae790f3f07696f

app.use(express.json());
app.use(cors());

<<<<<<< HEAD
// --- BANCO DE DADOS SIMPLIFICADO (Para teste do Pagamento) ---
// Em breve podemos reconectar ao Supabase se você quiser.
=======
// Seus produtos
>>>>>>> c9c989709261ea527186a7017eae790f3f07696f
let produtos = [
    { id: 1, nome: 'Batom Vermelho', preco: 50.00, estoque: 10, validade: '2026-12-30' },
    { id: 2, nome: 'Creme Hidratante', preco: 85.50, estoque: 5, validade: '2025-11-20' },
    { id: 3, nome: 'Perfume Floral', preco: 120.00, estoque: 2, validade: '2027-01-15' }
];

<<<<<<< HEAD
// Rota 1: Listar Produtos (Para a Loja e Gerente)
=======
>>>>>>> c9c989709261ea527186a7017eae790f3f07696f
app.get('/produtos', (req, res) => {
    res.json(produtos);
});

<<<<<<< HEAD
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
=======
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
>>>>>>> c9c989709261ea527186a7017eae790f3f07696f
                },
                quantity: 1,
            };
        });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: line_items,
            mode: 'payment',
            // Onde o cliente vai parar se der certo:
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            // Onde o cliente vai parar se ele desistir no meio:
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
        });

<<<<<<< HEAD
        console.log("Sessão criada com sucesso:", session.url);
        
        // Devolve o link seguro para o site
        res.json({ url: session.url });

    } catch (error) {
        console.error("ERRO CRÍTICO NO STRIPE:", error);
        // Devolve o erro para o site saber o que houve
        res.status(500).json({ error: "Erro ao criar pagamento: " + error.message });
=======
        console.log("Sessão criada:", session.url);
        res.json({ url: session.url });

    } catch (error) {
        console.error("ERRO NO STRIPE:", error); // Isso vai aparecer no Log do Render
        res.status(500).json({ error: error.message });
>>>>>>> c9c989709261ea527186a7017eae790f3f07696f
    }
});

// Porta do Servidor (Padrão do Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
<<<<<<< HEAD
    console.log(`Servidor seguro rodando na porta ${PORT}`);
});
=======
    console.log(`Servidor rodando na porta ${PORT}`);
});
>>>>>>> c9c989709261ea527186a7017eae790f3f07696f
