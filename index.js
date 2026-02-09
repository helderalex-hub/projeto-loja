const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

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
    const taxa = venda.taxa_iva_aplicada || 23;
    const itensLista = venda.itens.map(i => {
        const precoBase = parseFloat(i.preco);
        const valorIvaItem = precoBase * (taxa / 100);
        const totalItem = precoBase + valorIvaItem;
        return `<tr><td style="padding:10px;">${i.nome}</td><td style="text-align:right;">€${totalItem.toFixed(2)}</td></tr>`;
    }).join('');

    const htmlRecibo = `<div style="font-family:sans-serif; border:1px solid #ddd; padding:20px;">
        <h2 style="color:#cca43b">Recibo #${venda.codigo_pedido}</h2>
        <p>Olá ${venda.cliente_nome}, obrigado pela sua compra!</p>
        <p><strong>Envio para:</strong><br>${venda.cliente_morada}<br>Tel: ${venda.telefone_contato || 'N/A'}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:20px;">
            <tr style="background:#f8f8f8; font-weight:bold;"><td>Item</td><td style="text-align:right;">Total</td></tr>
            ${itensLista}
        </table>
        <p style="text-align:right; font-size:18px; margin-top:10px;"><strong>Total Pago: €${venda.total_venda.toFixed(2)}</strong></p>
        <div style="text-align:center; margin-top:20px;">
            <a href="https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${venda.codigo_pedido}" style="background:#0f172a; color:#fff; padding:10px 20px; text-decoration:none; border-radius:5px;">Baixar Recibo PDF</a>
        </div>
    </div>`;

    await enviarEmailViaBrevo(venda.cliente_email, `Recibo Lust Store: #${venda.codigo_pedido}`, htmlRecibo);
    await enviarEmailViaBrevo(process.env.EMAIL_USER, `Venda: #${venda.codigo_pedido}`, `<h3>Venda #${venda.codigo_pedido}</h3><p>Total: €${venda.total_venda}</p>`);
}

app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); if (req.method === 'OPTIONS') return res.status(200).end(); next(); });

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

            // 2. CRM: Criar ou Atualizar Cliente
            const emailCliente = session.customer_details.email;
            let clienteId = null;
            const { data: clienteExistente } = await supabase.from('clientes').select('id').eq('email', emailCliente).single();

            if (clienteExistente) {
                clienteId = clienteExistente.id;
                await supabase.from('clientes').update({
                    nome: session.customer_details.name,
                    telefone: meta.cli_telefone,
                    morada_completa: meta.cli_morada,
                    nif: meta.cli_nif,
                    pais: meta.pais_destino,
                    cp: meta.cli_cp
                }).eq('id', clienteId);
            } else {
                const { data: novoCliente } = await supabase.from('clientes').insert([{
                    email: emailCliente,
                    nome: session.customer_details.name,
                    telefone: meta.cli_telefone,
                    morada_completa: meta.cli_morada,
                    nif: meta.cli_nif,
                    pais: meta.pais_destino,
                    cp: meta.cli_cp
                }]).select().single();
                if (novoCliente) clienteId = novoCliente.id;
            }

            // 3. Registar Venda
            const total = session.amount_total / 100; 
            const frete = (session.total_details?.amount_shipping || 0) / 100;
            const receitaLiq = total - frete;
            
            const novaVenda = { 
                codigo_pedido: meta.codigo_pedido, 
                cliente_nome: session.customer_details.name, 
                cliente_email: emailCliente, 
                cliente_morada: meta.cli_morada, 
                telefone_contato: meta.cli_telefone,
                nif_cliente: meta.cli_nif,
                cliente_id: clienteId,
                itens: itensVendidos, 
                total_venda: total, 
                total_frete: frete, 
                total_custo: custoProdutos, 
                lucro: receitaLiq - custoProdutos, 
                pais_destino: meta.pais_destino, 
                taxa_iva_aplicada: parseFloat(meta.taxa_aplicada) 
            };
            
            await supabase.from('vendas').insert([novaVenda]);
            processarEmailsVenda(novaVenda).catch(console.error);
        }
    }
    res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send("API Online"));
app.get('/taxas', async (req, res) => { const { data } = await supabase.from('taxas_iva').select('*'); res.json(data || []); });
app.get('/config', async (req, res) => { const { data } = await supabase.from('config_loja').select('*').single(); res.json(data || {}); });
app.put('/config', async (req, res) => { const { error } = await supabase.from('config_loja').upsert({ id: 1, ...req.body }); if (error) return res.status(500).json({ error: error.message }); res.json({ success: true }); });
app.get('/pedido/:codigo', async (req, res) => { const { codigo } = req.params; const { data } = await supabase.from('vendas').select('*').eq('codigo_pedido', codigo).single(); res.json(data || {erro:true}); });
app.get('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true }); res.json(data || []); });
app.post('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').insert([req.body]).select(); res.json(data ? data[0] : null); });
app.put('/produtos/:id', async (req, res) => { const b = {...req.body}; delete b.id; delete b.created_at; const { data } = await supabase.from('produtos').update(b).eq('id', req.params.id).select(); res.json(data ? data[0] : null); });
app.delete('/produtos/:id', async (req, res) => { await supabase.from('produtos').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/vendas', async (req, res) => { const { data } = await supabase.from('vendas').select('*').order('data_venda', { ascending: false }); res.json(data || []); });
app.post('/login-admin', (req, res) => { const { senha } = req.body; if (senha === (process.env.SENHA_ADMIN || 'admin2026')) res.json({ sucesso: true, token: 'logado_sucesso_servidor' }); else res.status(401).json({ sucesso: false }); });

app.post('/checkout', async (req, res) => {
    try {
        const { itens, pais, zip, tier, address, city, phone, nif } = req.body;
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

        // LÓGICA DE FRETE (TIER + ZONA)
        let custoFinal = 0;
        let nomeServico = "Envio";
        let estimativa = { min: 2, max: 5 };
        let custoStd = 0, custoExp = 0, limiteFree = 9999;
        let nomeStd = "", nomeExp = "";

        if (pais === 'PT') {
            const isIlhas = zip && zip.startsWith('9');
            limiteFree = cf.pt_free;
            if (isIlhas) {
                custoStd = cf.pt_std + 2.00; custoExp = cf.pt_exp + 4.00;
                nomeStd = "Envio Ilhas (Marítimo)"; nomeExp = "Envio Ilhas (Aéreo)";
                estimativa = tier === 'exp' ? {min: 2, max: 4} : {min: 5, max: 9};
            } else {
                custoStd = cf.pt_std; custoExp = cf.pt_exp;
                nomeStd = "Portugal Continental (CTT)"; nomeExp = "Portugal Expresso (24h)";
                estimativa = tier === 'exp' ? {min: 1, max: 2} : {min: 2, max: 4};
            }
        } else if (pais === 'ES') {
            custoStd = cf.es_std; custoExp = cf.es_exp; limiteFree = cf.es_free;
            nomeStd = "Espanha Standard"; nomeExp = "Espanha Urgente";
        } else {
            custoStd = cf.eu_std; custoExp = cf.eu_exp; limiteFree = cf.eu_free;
            nomeStd = "Europa Standard"; nomeExp = "Europa Express";
        }

        if (tier === 'exp') {
            custoFinal = custoExp; nomeServico = nomeExp;
        } else {
            custoFinal = totalComImposto >= limiteFree ? 0 : custoStd;
            nomeServico = totalComImposto >= limiteFree ? `${nomeStd} (Ofertado)` : nomeStd;
        }

        const moradaCompletaParaBD = `${address}, ${zip}, ${city}`;

        const session = await stripe.checkout.sessions.create({ 
            payment_method_types: ['card'], 
            shipping_address_collection: { allowed_countries: [pais] }, 
            shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: Math.round(custoFinal * 100), currency: 'eur' }, display_name: nomeServico, delivery_estimate: { minimum: { unit: 'business_day', value: estimativa.min }, maximum: { unit: 'business_day', value: estimativa.max } } } }],
            line_items: line_items, 
            mode: 'payment', 
            success_url: `https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${novoIdPedido}`, 
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html', 
            metadata: { 
                ids_produtos: itens.map(i => i.id).join(','), 
                codigo_pedido: novoIdPedido, 
                pais_destino: pais, 
                taxa_aplicada: taxa,
                cli_morada: moradaCompletaParaBD,
                cli_cidade: city,
                cli_cp: zip,
                cli_telefone: phone,
                cli_nif: nif
            } 
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta ${PORT}`));
