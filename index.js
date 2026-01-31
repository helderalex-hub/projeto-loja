const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();

// 1. CONFIGURAÇÃO DE SEGURANÇA E ACESSO
app.use(cors());

// 2. WEBHOOK DO STRIPE (Deve ser a primeira rota e usar express.raw)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log("💳 Pagamento confirmado! Processando baixa de stock e venda...");

        try {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { 
                expand: ['data.price.product'] 
            });

            for (const item of lineItems.data) {
                const produtoId = item.price.product.metadata.id_supabase;
                if (produtoId) {
                    const { data: p } = await supabase.from('produtos').select('*').eq('id', produtoId).single();
                    if (p) {
                        // Baixa de Stock
                        const novoEstoque = Math.max(0, p.estoque - 1);
                        await supabase.from('produtos').update({ estoque: novoEstoque }).eq('id', produtoId);
                        
                        // Registro de Venda com Cálculo de Lucro
                        await supabase.from('vendas').insert([{
                            produto_nome: p.nome,
                            quantidade: 1,
                            valor_pago: p.preco,
                            lucro_real: p.preco - (p.preco_entrada || 0)
                        }]);
                        console.log(`✅ Stock atualizado e venda registrada: ${p.nome}`);
                    }
                }
            }

            enviarEmail(
                "✅ NOVA VENDA CONFIRMADA!", 
                `Uma venda de €${(session.amount_total / 100).toFixed(2)} foi processada com sucesso. O stock foi atualizado.`
            ).catch(e => console.log("Erro e-mail venda:", e.message));

        } catch (err) {
            console.error("Erro no processamento pós-venda:", err);
        }
    }
    res.json({ received: true });
});

// 3. MIDDLEWARES PARA AS ROTAS RESTANTES (JSON Ativado)
app.use(express.json());

// 4. CLIENTES E TRANSPORTADORES
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000
});

async function enviarEmail(assunto, texto) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Envia para si mesmo
            subject: assunto,
            text: texto
        });
        console.log("📧 Notificação enviada.");
    } catch (err) {
        console.error("❌ Erro ao enviar e-mail:", err.message);
    }
}

// 5. ROTAS DA API (COERENTES COM O GERENTE DARK MODE)

// Listar Produtos
app.get('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json(error);
    res.json(data || []);
});

// Criar Novo Produto (POST)
app.post('/produtos', async (req, res) => {
    console.log("📥 Recebido novo cadastro:", req.body);
    const { data, error } = await supabase.from('produtos').insert([req.body]).select();
    if (error) return res.status(400).json(error);
    res.status(201).json(data[0]);
});

// Editar Produto Existente (PUT)
app.put('/produtos/:id', async (req, res) => {
    console.log("✏️ Editando produto ID:", req.params.id);
    const { error } = await supabase.from('produtos').update(req.body).eq('id', req.params.id);
    if (error) return res.status(400).json(error);
    res.json({ message: "Produto atualizado com sucesso" });
});

// Eliminar Produto (DELETE)
app.delete('/produtos/:id', async (req, res) => {
    const { error } = await supabase.from('produtos').delete().eq('id', req.params.id);
    if (error) return res.status(400).json(error);
    res.json({ message: "Produto eliminado" });
});

// Gerar Sessão de Checkout do Stripe
app.post('/checkout', async (req, res) => {
    try {
        const line_items = req.body.itens.map(item => ({
            price_data: {
                currency: 'eur',
                product_data: { 
                    name: item.nome, 
                    metadata: { id_supabase: item.id } 
                },
                unit_amount: Math.round(item.preco * 100),
            },
            quantity: 1,
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items,
            mode: 'payment',
            success_url: 'https://helderalex-hub.github.io/projeto-loja/sucesso.html',
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
        });
        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. AUTOMAÇÃO DE RELATÓRIO (DIÁRIO ÀS 18:00)
cron.schedule('0 18 * * *', async () => {
    console.log("⏳ Iniciando relatório diário das 18h...");
    try {
        const { data: produtos } = await supabase.from('produtos').select('*');
        const stockBaixo = produtos.filter(p => p.estoque <= 5).map(p => `- ${p.nome}: ${p.estoque}`).join('\n');
        const totalPVP = produtos.reduce((acc, p) => acc + (p.preco * p.estoque), 0);

        const corpoRelatorio = `📊 RELATÓRIO DE STOCK E INVENTÁRIO\n\n` +
                               `⚠️ ITENS COM STOCK BAIXO (≤ 5):\n${stockBaixo || 'Tudo em ordem!'}\n\n` +
                               `💰 VALOR TOTAL EM LOJA (PVP): €${totalPVP.toFixed(2)}\n\n` +
                               `Equipa Beleza & Cia Hub.`;

        await enviarEmail("📊 Relatório de Inventário Diário", corpoRelatorio);
    } catch (err) {
        console.error("Erro ao gerar relatório:", err);
    }
}, { timezone: "Europe/Lisbon" });

// 7. INICIALIZAÇÃO DO SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 SERVIDOR OPERACIONAL NA PORTA ${PORT}`);
    console.log(`🔗 ROTA DE PRODUTOS: /produtos`);
});
