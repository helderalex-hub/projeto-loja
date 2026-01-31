const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();

// 1. CONFIGURAÇÕES INICIAIS
app.use(cors());

// Configuração do Transportador de E-mail (Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'helderalex@gmail.com', // O teu e-mail
        pass: 'frmy ugsm iyza dlrd'   // A tua App Password gerada
    }
});

// Função auxiliar para enviar e-mails
async function enviarEmail(assunto, texto) {
    try {
        await transporter.sendMail({
            from: 'helderalex@gmail.com',
            to: 'helderalex@gmail.com',
            subject: assunto,
            text: texto
        });
        console.log("📧 E-mail enviado com sucesso.");
    } catch (err) {
        console.error("❌ Erro ao enviar e-mail:", err);
    }
}

// Iniciar Cliente Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Webhook do Stripe (Baixa de stock e Registo de Venda)
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
        
        // Envia e-mail imediato de aviso de venda
        await enviarEmail(
            "✅ NOVO PEDIDO PAGO!", 
            `Um pagamento de €${(session.amount_total / 100).toFixed(2)} foi confirmado. Verifique o painel para preparar o envio.`
        );

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });

        for (const item of lineItems.data) {
            const produtoId = item.price.product.metadata.id_supabase;
            if (produtoId) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', produtoId).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: p.estoque - 1 }).eq('id', produtoId);
                    await supabase.from('vendas').insert([{
                        produto_nome: p.nome,
                        quantidade: 1,
                        valor_pago: p.preco,
                        lucro_real: p.preco - (p.preco_entrada || 0)
                    }]);
                }
            }
        }
    }
    res.send();
});

app.use(express.json());

// 2. RELATÓRIO AGENDADO (Todos os dias às 18:00 de Lisboa)
cron.schedule('0 18 * * *', async () => {
    console.log("⏳ Gerando relatório das 18h...");
    try {
        const { data: produtos } = await supabase.from('produtos').select('*');
        
        const stockBaixo = produtos
            .filter(p => p.estoque <= 5)
            .map(p => `- ${p.nome}: ${p.estoque} unidades`)
            .join('\n');

        const totalInventario = produtos.reduce((acc, p) => acc + (p.preco * p.estoque), 0);

        const textoRelatorio = `
📊 RELATÓRIO DIÁRIO DE INVENTÁRIO (18:00)
------------------------------------------
Data: ${new Date().toLocaleDateString('pt-PT')}

⚠️ PRODUTOS COM STOCK BAIXO (<= 5):
${stockBaixo || 'Nenhum produto em nível crítico.'}

💰 VALOR TOTAL EM STOCK: €${totalInventario.toFixed(2)}

Painel Administrativo: https://helderalex-hub.github.io/projeto-loja/gerente.html
        `;

        await enviarEmail("📊 Relatório de Stock Diário", textoRelatorio);
    } catch (err) {
        console.error("Erro no relatório agendado:", err);
    }
}, { timezone: "Europe/Lisbon" });

// 3. ROTAS DE PRODUTOS
app.get('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json(error);
    res.json(data || []);
});

app.post('/produtos', async (req, res) => {
    try {
        const { nome, preco, preco_entrada, estoque, validade, imagem } = req.body;
        const { data, error } = await supabase.from('produtos').insert([{
            nome,
            preco: parseFloat(preco) || 0,
            preco_entrada: parseFloat(preco_entrada || 0),
            esto
