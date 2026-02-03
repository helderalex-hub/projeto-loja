const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const nodemailer = require('nodemailer'); // <--- ISTO FALTAVA

const app = express();

// --- CONFIGURAÇÃO DO EMAIL (GMAIL) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- GERADOR DE ID (LUST STORE) ---
function gerarIdLust() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let codigo = '';
    for (let i = 0; i < 4; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    return `LS-${codigo}`;
}

// --- FUNÇÃO DE ENVIO DE EMAIL (CLIENTE + ADMIN) ---
async function enviarEmailsInstantaneos(venda) {
    const itensLista = venda.itens.map(i => `• ${i.nome} (€${i.preco})`).join('\n');
    
    // 1. Email Estilizado para o CLIENTE
    const htmlCliente = `
        <div style="font-family: 'Segoe UI', sans-serif; color: #333; max-width: 600px; border: 1px solid #eee;">
            <div style="background: #0f172a; padding: 20px; text-align: center;">
                <h1 style="color: #cca43b; margin: 0; font-size: 24px; letter-spacing: 2px;">LUST STORE</h1>
            </div>
            <div style="padding: 20px;">
                <h2 style="color: #0f172a;">Encomenda Confirmada!</h2>
                <p>Olá <b>${venda.cliente_nome}</b>,</p>
                <p>Obrigado pela sua preferência. A sua encomenda foi registada com sucesso.</p>
                
                <div style="background: #f8fafc; padding: 15px; border-left: 4px solid #cca43b; margin: 20px 0;">
                    <p style="margin:0; font-size: 12px; color: #64748b;">ID DO PEDIDO</p>
                    <p style="margin:0; font-size: 20px; font-weight: bold; color: #0f172a;">#${venda.codigo_pedido}</p>
                </div>

                <h3>📦 Resumo:</h3>
                <pre style="font-family: inherit; background: #eee; padding: 10px;">${itensLista}</pre>
                
                <p><b>Total Pago: €${venda.total_venda.toFixed(2)}</b></p>
                <p style="font-size: 13px; color: #666;">Enviaremos o código de rastreio assim que a encomenda for expedida.</p>
            </div>
        </div>
    `;

    // 2. Email Alerta para o ADMIN
    const mailOptionsCliente = { from: `"Lust Store" <${process.env.EMAIL_USER}>`, to: venda.cliente_email, subject: `💎 Encomenda Confirmada: #${venda.codigo_pedido}`, html: htmlCliente };
    const mailOptionsAdmin = { from: `"Sistema Lust" <${process.env.EMAIL_USER}>`, to: process.env.EMAIL_USER, subject: `💰 NOVA VENDA: #${venda.codigo_pedido}`, text: `NOVA VENDA!\nCliente: ${venda.cliente_nome}\nTotal: €${venda.total_venda}\nItens:\n${itensLista}` };

    try {
        await transporter.sendMail(mailOptionsCliente);
        await transporter.sendMail(mailOptionsAdmin);
        console.log(`[EMAIL] Enviados para venda #${venda.codigo_pedido}`);
        return true;
    } catch (error) {
        console.error("[ERRO EMAIL]", error);
        return false;
    }
}

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// --- ROTA SECRETA: RELATÓRIO DIÁRIO (Para o Cron-job das 18:00) ---
app.get('/admin/resumo-diario', async (req, res) => {
    const { key } = req.query;
    if (key !== (process.env.CRON_SECRET || 'LustAdmin2026')) return res.status(403).send("Acesso Proibido");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const { data: vendas } = await supabase.from('vendas').select('*').gte('data_venda', hoje.toISOString());
    if (!vendas || vendas.length === 0) return res.send("Sem vendas hoje.");

    let tFat = 0;
    vendas.forEach(v => tFat += parseFloat(v.total_venda));

    try {
        await transporter.sendMail({
            from: `"Sistema Lust" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: `📊 Fecho Diário: €${tFat.toFixed(2)}`,
            text: `Total Faturado Hoje: €${tFat.toFixed(2)}\nNúmero de Vendas: ${vendas.length}`
        });
        res.send("Relatório Enviado ✅");
    } catch (e) { res.status(500).send("Erro email"); }
});

// WEBHOOK STRIPE (O GATILHO)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } 
    catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

        if (session.metadata && session.metadata.ids_produtos) {
            const ids = session.metadata.ids_produtos.split(',');
            const codigoPedido = session.metadata.codigo_pedido || 'N/A';
            let custoProdutos = 0; let itensVendidos = [];

            for (const id of ids) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', id).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                    custoProdutos += (p.preco_entrada || 0);
                    itensVendidos.push({ nome: p.nome, preco: p.preco });
                }
            }
            
            const total = session.amount_total / 100;
            const frete = (session.total_details?.amount_shipping || 0) / 100;
            const receitaLiq = total - frete;
            const details = session.shipping_details || session.customer_details;
            const morada = details.address ? `${details.address.line1}, ${details.address.postal_code} ${details.address.city}, ${details.address.country}` : 'N/A';

            const novaVenda = {
                cliente_nome: details.name, cliente_email: session.customer_details.email, cliente_morada: morada,
                itens: itensVendidos, codigo_pedido: codigoPedido, total_venda: total, total_frete: frete,
                total_custo: custoProdutos, lucro: receitaLiq - custoProdutos
            };

            await supabase.from('vendas').insert([novaVenda]);
            
            // DISPARAR EMAILS IMEDIATOS <--- ISTO FALTAVA NO SEU CÓDIGO
            await enviarEmailsInstantaneos(novaVenda);
        }
    }
    res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send("API Lust Store: ONLINE 💎"));

// Rota Detalhes Pedido
app.get('/pedido/:codigo', async (req, res) => {
    const { codigo } = req.params;
    const { data, error } = await supabase.from('vendas').select('cliente_nome, cliente_morada, itens, total_frete, total_venda').eq('codigo_pedido', codigo).single();
    if (error || !data) return res.status(404).json({ erro: 'Pedido não encontrado' });
    res.json(data);
});

// --- ROTA DE REENVIAR EMAIL (Para o Botão do Admin) ---
app.post('/reenviar-email/:id', async (req, res) => {
    const { data: venda } = await supabase.from('vendas').select('*').eq('id', req.params.id).single();
    if(venda) { 
        const sucesso = await enviarEmailsInstantaneos(venda); 
        if (sucesso) res.json({ sucesso: true });
        else res.status(500).json({ erro: "Falha no envio (ver logs)" });
    } else { 
        res.status(404).json({ erro: "Venda não encontrada" }); 
    }
});

// Rotas Admin e Checkout (Mantidas iguais)
app.post('/login-admin', (req, res) => { const { senha } = req.body; if (senha === (process.env.SENHA_ADMIN || 'admin2026')) res.json({ sucesso: true, token: 'logado_sucesso_servidor' }); else res.status(401).json({ sucesso: false }); });
app.get('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true }); res.json(data || []); });
app.post('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').insert([req.body]).select(); res.json(data ? data[0] : null); });
app.put('/produtos/:id', async (req, res) => { const b = {...req.body}; delete b.id; delete b.created_at; const { data } = await supabase.from('produtos').update(b).eq('id', req.params.id).select(); res.json(data ? data[0] : null); });
app.delete('/produtos/:id', async (req, res) => { await supabase.from('produtos').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/vendas', async (req, res) => { const { periodo } = req.query; let q = supabase.from('vendas').select('*').order('data_venda', { ascending: false }); const h = new Date(); h.setHours(0,0,0,0); if(periodo === 'diario') q = q.gte('data_venda', h.toISOString()); else if(periodo === 'mensal') { const m = new Date(); m.setDate(1); m.setHours(0,0,0,0); q = q.gte('data_venda', m.toISOString()); } const { data } = await q; res.json(data || []); });

app.post('/checkout', async (req, res) => {
    try {
        const itens = req.body;
        const novoIdPedido = gerarIdLust(); 
        let total = 0;
        const line_items = itens.map(i => {
            total += Math.round(i.preco * 100);
            return { price_data: { currency: 'eur', product_data: { name: i.nome }, unit_amount: Math.round(i.preco * 100) }, quantity: 1 };
        });
        const s_options = [
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: total >= 6000 ? 0 : 450, currency: 'eur' }, display_name: 'Portugal: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 4 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 800, currency: 'eur' }, display_name: 'Portugal: Expresso', delivery_estimate: { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 2 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: total >= 8500 ? 0 : 595, currency: 'eur' }, display_name: 'Espanha: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 5 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: total >= 12500 ? 0 : 1250, currency: 'eur' }, display_name: 'Europa: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 10 } } } },
            { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 2500, currency: 'eur' }, display_name: 'Europa: Expresso', delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 3 } } } }
        ];
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            shipping_address_collection: { allowed_countries: ['PT', 'ES', 'FR', 'DE', 'IT', 'NL', 'BE', 'LU', 'IE', 'AT'] },
            shipping_options: s_options,
            line_items: line_items,
            mode: 'payment',
            success_url: `https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${novoIdPedido}`,
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html',
            metadata: { ids_produtos: itens.map(i => i.id).join(','), codigo_pedido: novoIdPedido }
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta ${PORT}`));
