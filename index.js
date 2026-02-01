const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// --- 1. CONFIGURAÇÃO DE CORS (Permite acesso da Loja e do Admin) ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// --- 2. WEBHOOK STRIPE (Baixa Estoque + Regista Venda no Histórico) ---
// Deve vir ANTES do express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // Recupera os IDs guardados no momento do checkout
        if (session.metadata && session.metadata.ids_produtos) {
            const ids = session.metadata.ids_produtos.split(',');
            
            let custoTotalVenda = 0;
            let itensVendidos = [];

            // Inicializa cliente Supabase aqui dentro para garantir contexto
            const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

            // Loop para atualizar estoque e calcular custos
            for (const id of ids) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', id).single();
                if(p) {
                    // Baixa 1 unidade do estoque
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                    
                    // Soma custos para relatório
                    custoTotalVenda += (p.preco_entrada || 0);
                    itensVendidos.push({ 
                        nome: p.nome, 
                        preco_venda: p.preco, 
                        preco_custo: p.preco_entrada 
                    });
                }
            }

            // Grava na tabela 'vendas' (Necessário ter criado a tabela no Supabase)
            const totalPago = session.amount_total / 100; // Converte cêntimos para euros
            const lucroReal = totalPago - custoTotalVenda;

            await supabase.from('vendas').insert([{
                itens: itensVendidos,
                total_venda: totalPago,
                total_custo: custoTotalVenda,
                lucro: lucroReal,
                data_venda: new Date()
            }]);
            
            console.log(`💰 Venda registada! Lucro: €${lucroReal}`);
        }
    }
    res.json({ received: true });
});

// --- MIDDLEWARE PADRÃO ---
app.use(express.json());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 3. ROTA DE SEGURANÇA (LOGIN ADMIN) ---
app.post('/login-admin', (req, res) => {
    const { senha } = req.body;
    
    // Pega a senha do Render (Environment Variables). 
    // Se não tiver configurada lá, usa 'admin2026' por padrão.
    const senhaCorreta = process.env.SENHA_ADMIN || 'admin2026';

    if (senha === senhaCorreta) {
        res.json({ sucesso: true, token: 'logado_sucesso_servidor' });
    } else {
        res.status(401).json({ sucesso: false, erro: 'Senha incorreta' });
    }
});

// --- 4. ROTAS DE PRODUTOS (CRUD) ---
app.get('/', (req, res) => res.send('🚀 Servidor Beleza & Cia ON'));

app.get('/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
        if (error) throw error;
        res.status(200).json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').insert([req.body]).select();
    res.json(data ? data[0] : {error});
});

app.put('/produtos/:id', async (req, res) => {
    const b = {...req.body}; delete b.id; delete b.created_at;
    const { data, error } = await supabase.from('produtos').update(b).eq('id', req.params.id).select();
    res.json(data ? data[0] : {error});
});

app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').delete().eq('id', req.params.id);
    res.json({ success: true });
});

// --- 5. ROTA DE CHECKOUT (STRIPE) ---
app.post('/checkout', async (req, res) => {
    try {
        const itens = req.body;
        const line_items = itens.map(item => ({
            price_data: {
                currency: 'eur',
                product_data: { 
                    name: item.nome, 
                    images: item.imagem ? [item.imagem] : [],
                },
                unit_amount: Math.round(item.preco * 100),
            },
            quantity: 1, // Logica simples: 1 unidade por item no array
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items,
            mode: 'payment',
            success_url: '
