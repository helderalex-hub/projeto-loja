const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

const LOGO_URL = "https://helderalex-hub.github.io/projeto-loja/logo.png";

async function enviarEmailViaBrevo(para, assunto, htmlContent) {
    const url = 'https://api.brevo.com/v3/smtp/email';
    const options = {
        method: 'POST',
        headers: { 
            'accept': 'application/json', 
            'api-key': process.env.BREVO_KEY, 
            'content-type': 'application/json' 
        },
        body: JSON.stringify({ 
            sender: { name: "Lust Store", email: process.env.EMAIL_USER }, 
            to: [{ email: para }], 
            subject: assunto, 
            htmlContent: htmlContent 
        })
    };
    try { const r = await fetch(url, options); return r.ok; } catch (e) { console.error(e); return false; }
}

function gerarIdLust() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let codigo = ''; for (let i = 0; i < 4; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    return `LS-${codigo}`;
}

// GERA HTML DO RECIBO (REUTILIZÁVEL)
function gerarHtmlRecibo(venda) {
    const taxa = venda.taxa_iva_aplicada || 23;
    const itensLista = venda.itens.map(i => {
        const precoBase = parseFloat(i.preco);
        const valorIvaItem = precoBase * (taxa / 100);
        const totalItem = precoBase + valorIvaItem;
        return `
        <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px; color: #555;">[${i.sku || 'N/A'}] ${i.nome}</td>
            <td style="padding: 10px; text-align: right; color: #555;">€${precoBase.toFixed(2)}</td>
            <td style="padding: 10px; text-align: right; color: #555;">${taxa}%</td>
            <td style="padding: 10px; text-align: right; font-weight: bold; color: #555;">€${totalItem.toFixed(2)}</td>
        </tr>`;
    }).join('');

    return `
        <div style="font-family: 'Helvetica', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; background: #fff;">
            <div style="background: #0f172a; padding: 30px; text-align: center; border-bottom: 4px solid #cca43b;">
                <img src="${LOGO_URL}" alt="Lust Store" style="height: 60px; display: block; margin: 0 auto 10px auto;">
                <h1 style="color: #fff; margin: 0; font-family: 'Times New Roman', serif; letter-spacing: 2px; font-size: 20px;">LUST STORE</h1>
            </div>
            <div style="padding: 30px;">
                <p>Olá <strong>${venda.cliente_nome.split(' ')[0]}</strong>, o seu pagamento foi confirmado!</p>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-top:20px;">
                    <thead><tr style="background: #f8fafc; color: #94a3b8; font-size: 10px; text-transform: uppercase;"><th style="padding: 10px; text-align: left;">Descrição</th><th style="padding: 10px; text-align: right;">Base</th><th style="padding: 10px; text-align: right;">IVA</th><th style="padding: 10px; text-align: right;">Total</th></tr></thead>
                    <tbody>${itensLista}</tbody>
                </table>
                <div style="margin-top: 20px; border-top: 2px solid #0f172a; padding-top: 15px; text-align: right;">
                    <p><strong>TOTAL PAGO: €${venda.total_venda.toFixed(2)}</strong></p>
                </div>
            </div>
        </div>
    `;
}

// GERA HTML DO RASTREIO (REUTILIZÁVEL)
function gerarHtmlRastreio(venda) {
    let linkRastreio = "#";
    const transp = venda.transportadora || "Transportadora";
    const cod = venda.codigo_rastreio || "Indisponível";

    if (transp.toLowerCase().includes('ctt')) linkRastreio = `https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects=${cod}`;
    else if (transp.toLowerCase().includes('dpd')) linkRastreio = `https://dpd.pt/rastrear?reference=${cod}`;
    else linkRastreio = `https://www.google.com/search?q=${transp}+tracking+${cod}`;

    return `
        <div style="font-family: 'Helvetica', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff; color: #333;">
            <div style="background: #0f172a; padding: 20px; text-align: center; border-bottom: 4px solid #cca43b;">
                <h1 style="color: #fff; margin: 0; font-family: 'Times New Roman', serif;">LUST STORE</h1>
            </div>
            <div style="padding: 30px; border: 1px solid #e2e8f0;">
                <h2 style="color: #cca43b; margin-top: 0;">A sua encomenda está a caminho! 🚚</h2>
                <p>Olá <strong>${venda.cliente_nome.split(' ')[0]}</strong>,</p>
                <p>O seu pedido <strong>#${venda.codigo_pedido}</strong> já saiu do nosso armazém.</p>
                <div style="background: #f8fafc; padding: 15px; border-left: 4px solid #cca43b; margin: 20px 0;">
                    <p style="margin: 0; font-size: 12px; color: #64748b;">CÓDIGO DE RASTREIO:</p>
                    <p style="margin: 5px 0 0 0; font-weight: bold; font-size: 18px;">${cod}</p>
                    <p style="margin: 5px 0 0 0; font-size: 12px;">Via: ${transp}</p>
                </div>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${linkRastreio}" style="background: #0f172a; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-weight: bold;">ACOMPANHAR ENTREGA</a>
                </div>
            </div>
        </div>
    `;
}

// --- MIDDLEWARES ---
app.use((req, res, next) => { 
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); 
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); 
    if (req.method === 'OPTIONS') return res.status(200).end(); 
    next(); 
});

// --- ROTA WEBHOOK (REGISTO VENDA) ---
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }
    
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        
        if (session.metadata && session.metadata.ids_produtos) {
            const meta = session.metadata;
            // 1. Atualizar Stock
            const ids = meta.ids_produtos.split(',');
            let custoProdutos = 0; let itensVendidos = [];
            for (const id of ids) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', id).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                    custoProdutos += (p.preco_entrada || 0);
                    itensVendidos.push({ nome: p.nome, preco: p.preco, marca: p.marca, sku: p.sku });
                }
            }
            // 2. CRM
            const emailCliente = session.customer_details.email;
            let clienteId = null;
            const { data: clienteExistente } = await supabase.from('clientes').select('id').eq('email', emailCliente).single();
            if (clienteExistente) {
                clienteId = clienteExistente.id;
                await supabase.from('clientes').update({ nome: session.customer_details.name, telefone: meta.cli_telefone, morada_completa: meta.cli_morada, nif: meta.cli_nif, pais: meta.pais_destino, cp: meta.cli_cp, cidade: meta.cli_cidade }).eq('id', clienteId);
            } else {
                const { data: novoCliente } = await supabase.from('clientes').insert([{ email: emailCliente, nome: session.customer_details.name, telefone: meta.cli_telefone, morada_completa: meta.cli_morada, nif: meta.cli_nif, pais: meta.pais_destino, cp: meta.cli_cp, cidade: meta.cli_cidade }]).select().single();
                if (novoCliente) clienteId = novoCliente.id;
            }
            // 3. Registar Venda
            const total = session.amount_total / 100; const frete = (session.total_details?.amount_shipping || 0) / 100; const receitaLiq = total - frete;
            const metodoPagamento = session.payment_method_types ? session.payment_method_types[0] : 'stripe';
            const novaVenda = { codigo_pedido: meta.codigo_pedido, cliente_nome: session.customer_details.name, cliente_email: emailCliente, cliente_morada: meta.cli_morada, telefone_contato: meta.cli_telefone, nif_cliente: meta.cli_nif, cliente_id: clienteId, metodo_pagamento: metodoPagamento, itens: itensVendidos, total_venda: total, total_frete: frete, total_custo: custoProdutos, lucro: receitaLiq - custoProdutos, pais_destino: meta.pais_destino, taxa_iva_aplicada: parseFloat(meta.taxa_aplicada) };
            
            await supabase.from('vendas').insert([novaVenda]);
            // Envia Email 1 (Recibo)
            const html = gerarHtmlRecibo(novaVenda);
            await enviarEmailViaBrevo(novaVenda.cliente_email, `Recibo Lust Store: #${novaVenda.codigo_pedido}`, html);
            await enviarEmailViaBrevo(process.env.EMAIL_USER, `Venda: #${novaVenda.codigo_pedido}`, `Nova venda de €${total}`);
        }
    }
    res.json({ received: true });
});

// --- ROTA: ATUALIZAR RASTREIO E ENVIAR EMAIL 2 ---
app.post('/atualizar-rastreio', async (req, res) => {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); // Instancia aqui para garantir
    try {
        const { id, codigo_rastreio, transportadora } = req.body;
        const { data: venda } = await supabase.from('vendas').select('*').eq('id', id).single();
        if (!venda) throw new Error("Venda não encontrada");

        await supabase.from('vendas').update({ status_envio: 'Enviado', codigo_rastreio, transportadora, data_envio: new Date() }).eq('id', id);
        
        // Atualiza objeto local para gerar email correto
        venda.codigo_rastreio = codigo_rastreio; 
        venda.transportadora = transportadora;
        
        const html = gerarHtmlRastreio(venda);
        await enviarEmailViaBrevo(venda.cliente_email, `A sua Lust Box está a caminho! 🚚 (#${venda.codigo_pedido})`, html);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ROTA: REENVIAR EMAIL DE COMPRA (RECIBO) ---
app.post('/reenviar-recibo/:id', async (req, res) => {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    try {
        const { data: venda } = await supabase.from('vendas').select('*').eq('id', req.params.id).single();
        if (!venda) throw new Error("Venda não encontrada");
        const html = gerarHtmlRecibo(venda);
        await enviarEmailViaBrevo(venda.cliente_email, `(Reenvio) Recibo Lust Store: #${venda.codigo_pedido}`, html);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ROTA: REENVIAR EMAIL DE RASTREIO ---
app.post('/reenviar-rastreio/:id', async (req, res) => {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    try {
        const { data: venda } = await supabase.from('vendas').select('*').eq('id', req.params.id).single();
        if (!venda) throw new Error("Venda não encontrada");
        if (!venda.codigo_rastreio) throw new Error("Esta venda ainda não tem código de rastreio.");
        const html = gerarHtmlRastreio(venda);
        await enviarEmailViaBrevo(venda.cliente_email, `(Reenvio) A sua Lust Box está a caminho! 🚚`, html);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ROTAS PADRÃO ---
app.use(express.json({ limit: '10mb' }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send("API Lust Store: ONLINE 💎"));
app.get('/taxas', async (req, res) => { const { data } = await supabase.from('taxas_iva').select('*'); res.json(data || []); });
app.get('/config', async (req, res) => { const { data } = await supabase.from('config_loja').select('*').single(); res.json(data || {}); });
app.put('/config', async (req, res) => { const { error } = await supabase.from('config_loja').upsert({ id: 1, ...req.body }); if (error) return res.status(500).json({ error: error.message }); res.json({ success: true }); });
app.get('/pedido/:codigo', async (req, res) => { const { codigo } = req.params; const { data } = await supabase.from('vendas').select('*').eq('codigo_pedido', codigo).single(); res.json(data || {erro:true}); });
app.get('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true }); res.json(data || []); });
app.post('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').insert([req.body]).select(); res.json(data ? data[0] : null); });
app.put('/produtos/:id', async (req, res) => { const b = {...req.body}; delete b.id; delete b.created_at; const { data } = await supabase.from('produtos').update(b).eq('id', req.params.id).select(); res.json(data ? data[0] : null); });
app.delete('/produtos/:id', async (req, res) => { await supabase.from('produtos').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/vendas', async (req, res) => { const { data } = await supabase.from('vendas').select('*').order('data_venda', { ascending: false }); res.json(data || []); });
app.post('/login-admin', (req, res) => { const { senha } = req.body; if (senha === (process.env.SENHA_ADMIN)) res.json({ sucesso: true, token: 'logado_sucesso_servidor' }); else res.status(401).json({ sucesso: false }); });

// ROTA CHECKOUT
app.post('/checkout', async (req, res) => {
    try {
        const { itens, pais, zip, tier, address, city, phone, nif, nome, email } = req.body; 
        const novoIdPedido = gerarIdLust(); 
        const { data: config } = await supabase.from('config_loja').select('*').single();
        const cf = config || { pt_std: 4.50, pt_exp: 8.00, pt_free: 60, es_std: 5.95, es_exp: 9.95, es_free: 85, eu_std: 12.50, eu_exp: 25.00, eu_free: 125 };
        const { data: taxaData } = await supabase.from('taxas_iva').select('taxa_percentual').eq('pais_iso', pais).single();
        const taxa = taxaData ? taxaData.taxa_percentual : 23;
        let totalComImposto = 0;
        const line_items = itens.map(i => { 
            const precoBase = parseFloat(i.preco);
            const precoFinal = precoBase * (1 + (taxa / 100));
            totalComImposto += precoFinal;
            return { price_data: { currency: 'eur', product_data: { name: `[${i.sku || '?'}] ${i.nome}` }, unit_amount: Math.round(precoFinal * 100) }, quantity: 1 }; 
        });
        let custoFinal = 0; let nomeServico = "Envio"; let estimativa = { min: 2, max: 5 }; let custoStd = 0, custoExp = 0, limitFree = 9999; let nomeStd = "", nomeExp = "";
        if (pais === 'PT') { limitFree = cf.pt_free; const isIlhas = zip && zip.startsWith('9'); if (isIlhas) { custoStd = cf.pt_std + 2.00; custoExp = cf.pt_exp + 4.00; nomeStd = "Envio Ilhas (Marítimo)"; nomeExp = "Envio Ilhas (Aéreo)"; estimativa = tier === 'exp' ? {min: 2, max: 4} : {min: 5, max: 9}; } else { custoStd = cf.pt_std; custoExp = cf.pt_exp; nomeStd = "Portugal Continental (CTT)"; nomeExp = "Portugal Expresso (24h)"; estimativa = tier === 'exp' ? {min: 1, max: 2} : {min: 2, max: 4}; } } else if (pais === 'ES') { custoStd = cf.es_std; custoExp = cf.es_exp; limitFree = cf.es_free; nomeStd = "Espanha Standard"; nomeExp = "Espanha Urgente"; } else { custoStd = cf.eu_std; custoExp = cf.eu_exp; limitFree = cf.eu_free; nomeStd = "Europa Standard"; nomeExp = "Europa Express"; }
        if (tier === 'exp') { custoFinal = custoExp; nomeServico = nomeExp; } else { custoFinal = totalComImposto >= limitFree ? 0 : custoStd; nomeServico = totalComImposto >= limitFree ? `${nomeStd} (Ofertado)` : nomeStd; }
        const customer = await stripe.customers.create({ email: email, name: nome, phone: phone, address: { line1: address, city: city, postal_code: zip, country: pais }, shipping: { name: nome, phone: phone, address: { line1: address, city: city, postal_code: zip, country: pais } } });
        const session = await stripe.checkout.sessions.create({ payment_method_types: ['card'], customer: customer.id, customer_update: { address: 'auto', shipping: 'auto', name: 'auto' }, billing_address_collection: 'required', shipping_address_collection: { allowed_countries: [pais] }, shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: Math.round(custoFinal * 100), currency: 'eur' }, display_name: nomeServico, delivery_estimate: { minimum: { unit: 'business_day', value: estimativa.min }, maximum: { unit: 'business_day', value: estimativa.max } } } }], line_items: line_items, mode: 'payment', success_url: `https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${novoIdPedido}`, cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html', metadata: { ids_produtos: itens.map(i => i.id).join(','), codigo_pedido: novoIdPedido, pais_destino: pais, taxa_aplicada: taxa, cli_morada: `${address}, ${zip}, ${city}`, cli_cidade: city, cli_cp: zip, cli_telefone: phone, cli_nif: nif } });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta ${PORT}`));
