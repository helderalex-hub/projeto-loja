const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

const LOGO_URL = "https://helderalex-hub.github.io/projeto-loja/logo.png";

async function enviarEmailViaBrevo(para, assunto, htmlContent) {
    const url = 'https://api.brevo.com/v3/smtp/email';
    const options = {
        method: 'POST',
        headers: { 'accept': 'application/json', 'api-key': process.env.BREVO_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ sender: { name: "Lust Store", email: process.env.EMAIL_USER }, to: [{ email: para }], subject: assunto, htmlContent: htmlContent })
    };
    try { const r = await fetch(url, options); return r.ok; } catch (e) { console.error(e); return false; }
}

function gerarIdLust() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let codigo = ''; for (let i = 0; i < 4; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    return `LS-${codigo}`;
}

async function processarEmailsVenda(venda) {
    const itensLista = venda.itens.map(i => `<li style="padding: 10px 0; border-bottom: 1px solid #eee; color: #555;">${i.nome} <span style="float:right; font-weight:bold;">€${i.preco}</span></li>`).join('');
    
    // Define prazo estimado baseado no tipo de frete (simples lógica visual)
    const prazo = venda.total_frete > 7 ? "1 a 2 dias úteis (Expresso)" : "2 a 5 dias úteis (Standard)";

    const htmlCliente = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0;">
            <div style="background-color: #0f172a; padding: 40px 20px; text-align: center; border-bottom: 4px solid #cca43b;">
                <img src="${LOGO_URL}" alt="LUST STORE" style="max-width: 150px; height: auto; display: block; margin: 0 auto;">
                <p style="color: #cca43b; margin-top: 15px; font-size: 12px; letter-spacing: 4px; text-transform: uppercase;">Premium Beauty & Care</p>
            </div>
            <div style="padding: 40px 30px;">
                <h2 style="color: #0f172a; margin-top: 0; font-weight: 300;">Olá, ${venda.cliente_nome}.</h2>
                <p style="color: #64748b; font-size: 16px; line-height: 1.5;">Agradecemos a sua preferência. A sua encomenda <b>#${venda.codigo_pedido}</b> foi confirmada.</p>
                
                <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #e2e8f0;">
                    <p style="margin:0; font-size: 14px; color: #334155;">🚚 <strong>Estimativa de Entrega:</strong><br>${prazo} após envio.</p>
                </div>

                <h3 style="color: #0f172a; border-bottom: 1px solid #cca43b; padding-bottom: 10px; margin-top: 40px;">Resumo da Compra</h3>
                <ul style="list-style: none; padding: 0; margin: 0;">${itensLista}</ul>
                
                <div style="margin-top: 20px; text-align: right; border-top: 2px solid #f1f5f9; padding-top: 10px;">
                    <p style="margin: 5px 0; color: #64748b;">Subtotal: €${(venda.total_venda - venda.total_frete).toFixed(2)}</p>
                    <p style="margin: 5px 0; color: #64748b;">Envio: €${venda.total_frete.toFixed(2)}</p>
                    <p style="font-size: 20px; color: #0f172a; margin-top: 10px;">Total: <b style="color: #cca43b;">€${venda.total_venda.toFixed(2)}</b></p>
                </div>
            </div>
             <div style="background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
                <p>© 2026 Lust Store. Todos os direitos reservados.</p>
            </div>
        </div>
    `;

    const htmlAdmin = `
        <h3>💰 NOVA VENDA: #${venda.codigo_pedido}</h3>
        <p><b>Cliente:</b> ${venda.cliente_nome}</p>
        <p><b>Total Pago:</b> €${venda.total_venda.toFixed(2)} (Frete: €${venda.total_frete})</p>
        <p><b>Lucro Líquido:</b> <span style="color:green">€${venda.lucro.toFixed(2)}</span></p>
        <hr><h4>Itens para Embalar:</h4><ul>${itensLista}</ul>
    `;

    await enviarEmailViaBrevo(venda.cliente_email, `💎 Pedido Confirmado: #${venda.codigo_pedido}`, htmlCliente);
    await enviarEmailViaBrevo(process.env.EMAIL_USER, `💰 Venda: #${venda.codigo_pedido}`, htmlAdmin);
}

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// WEBHOOK
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
            const total = session.amount_total / 100; const frete = (session.total_details?.amount_shipping || 0) / 100;
            const receitaLiq = total - frete; const details = session.shipping_details || session.customer_details;
            const morada = details.address ? `${details.address.line1}, ${details.address.postal_code} ${details.address.city}, ${details.address.country}` : 'N/A';

            const novaVenda = { cliente_nome: details.name, cliente_email: session.customer_details.email, cliente_morada: morada, itens: itensVendidos, codigo_pedido: codigoPedido, total_venda: total, total_frete: frete, total_custo: custoProdutos, lucro: receitaLiq - custoProdutos };
            await supabase.from('vendas').insert([novaVenda]);
            processarEmailsVenda(novaVenda).catch(console.error);
        }
    }
    res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send("API Lust Store: ONLINE 💎"));
app.get('/pedido/:codigo', async (req, res) => {
    const { codigo } = req.params;
    const { data, error } = await supabase.from('vendas').select('*').eq('codigo_pedido', codigo).single();
    if (error || !data) return res.status(404).json({ erro: 'Pedido não encontrado' });
    res.json(data);
});

app.post('/reenviar-email/:id', async (req, res) => {
    const { data: venda } = await supabase.from('vendas').select('*').eq('id', req.params.id).single();
    if(venda) { await processarEmailsVenda(venda); res.json({ sucesso: true }); } 
    else { res.status(404).json({ erro: "Venda off" }); }
});

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
        const line_items = itens.map(i => { total += Math.round(i.preco * 100); return { price_data: { currency: 'eur', product_data: { name: i.nome }, unit_amount: Math.round(i.preco * 100) }, quantity: 1 }; });
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
            shipping_options: s_options, line_items: line_items, mode: 'payment', 
            success_url: `https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${novoIdPedido}`, 
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html', 
            metadata: { ids_produtos: itens.map(i => i.id).join(','), codigo_pedido: novoIdPedido } 
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta ${PORT}`));
