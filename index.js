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
    const taxa = venda.taxa_iva_aplicada || 23;
    
    // FORMATO DE RECIBO NO EMAIL
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

    const htmlRecibo = `
        <div style="font-family: 'Helvetica', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; background: #fff;">
            <div style="background: #0f172a; padding: 30px; text-align: center; border-bottom: 4px solid #cca43b;">
                <h1 style="color: #fff; margin: 0; font-family: 'Times New Roman', serif; letter-spacing: 2px;">LUST STORE</h1>
                <p style="color: #cca43b; font-size: 10px; text-transform: uppercase;">Premium Beauty & Care</p>
            </div>
            
            <div style="padding: 30px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
                    <div>
                        <p style="font-size: 12px; color: #94a3b8; margin: 0;">CLIENTE</p>
                        <p style="margin: 5px 0; color: #0f172a; font-weight: bold;">${venda.cliente_nome}</p>
                        <p style="margin: 0; color: #64748b; font-size: 12px;">${venda.pais_destino}</p>
                    </div>
                    <div style="text-align: right;">
                        <p style="font-size: 12px; color: #94a3b8; margin: 0;">RECIBO PROVISÓRIO</p>
                        <p style="margin: 5px 0; color: #cca43b; font-weight: bold;">#${venda.codigo_pedido}</p>
                        <p style="margin: 0; color: #64748b; font-size: 12px;">${new Date().toLocaleDateString()}</p>
                    </div>
                </div>

                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #f8fafc; color: #94a3b8; font-size: 10px; text-transform: uppercase;">
                            <th style="padding: 10px; text-align: left;">Descrição</th>
                            <th style="padding: 10px; text-align: right;">Base</th>
                            <th style="padding: 10px; text-align: right;">IVA</th>
                            <th style="padding: 10px; text-align: right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>${itensLista}</tbody>
                </table>

                <div style="margin-top: 20px; border-top: 2px solid #0f172a; padding-top: 15px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span style="color: #64748b;">Total Base (Líquido)</span>
                        <span style="color: #0f172a;">€${(venda.total_venda / (1 + taxa/100)).toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span style="color: #64748b;">Total IVA (${taxa}%)</span>
                        <span style="color: #0f172a;">€${(venda.total_venda - (venda.total_venda / (1 + taxa/100))).toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span style="color: #64748b;">Frete</span>
                        <span style="color: #0f172a;">€${venda.total_frete.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 18px; font-weight: bold;">
                        <span style="color: #0f172a;">TOTAL PAGO</span>
                        <span style="color: #cca43b;">€${venda.total_venda.toFixed(2)}</span>
                    </div>
                </div>

                <div style="margin-top: 30px; text-align: center;">
                    <a href="https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${venda.codigo_pedido}" style="background: #0f172a; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: bold;">BAIXAR RECIBO EM PDF</a>
                </div>
            </div>
            <div style="background: #f1f5f9; padding: 15px; text-align: center; font-size: 10px; color: #94a3b8;">
                <p>Este documento serve como comprovativo de encomenda. A fatura fiscal oficial será emitida em breve.</p>
            </div>
        </div>
    `;

    await enviarEmailViaBrevo(venda.cliente_email, `Recibo Lust Store: #${venda.codigo_pedido}`, htmlRecibo);
    await enviarEmailViaBrevo(process.env.EMAIL_USER, `Venda: #${venda.codigo_pedido}`, `<h3>Venda #${venda.codigo_pedido}</h3><p>Total: €${venda.total_venda}</p>`);
}

// ... (MIDDLEWARE CORS e WEBHOOK mantêm-se iguais, apenas garantem que guardam a taxa) ...
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); if (req.method === 'OPTIONS') return res.status(200).end(); next(); });

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        if (session.metadata && session.metadata.ids_produtos) {
            const ids = session.metadata.ids_produtos.split(',');
            const codigoPedido = session.metadata.codigo_pedido;
            const paisDestino = session.metadata.pais_destino;
            const taxaAplicada = parseFloat(session.metadata.taxa_aplicada);
            let custoProdutos = 0; let itensVendidos = [];
            for (const id of ids) {
                const { data: p } = await supabase.from('produtos').select('*').eq('id', id).single();
                if (p) {
                    await supabase.from('produtos').update({ estoque: Math.max(0, p.estoque - 1) }).eq('id', id);
                    custoProdutos += (p.preco_entrada || 0);
                    itensVendidos.push({ nome: p.nome, preco: p.preco, marca: p.marca, categoria: p.categoria, sku: p.sku });
                }
            }
            const total = session.amount_total / 100; 
            const frete = (session.total_details?.amount_shipping || 0) / 100;
            const receitaLiq = total - frete;
            const details = session.shipping_details || session.customer_details;
            const morada = details.address ? `${details.address.line1}, ${details.address.postal_code} ${details.address.city}, ${details.address.country}` : 'N/A';
            
            const novaVenda = { cliente_nome: details.name, cliente_email: session.customer_details.email, cliente_morada: morada, itens: itensVendidos, codigo_pedido: codigoPedido, total_venda: total, total_frete: frete, total_custo: custoProdutos, lucro: receitaLiq - custoProdutos, pais_destino: paisDestino, taxa_iva_aplicada: taxaAplicada };
            await supabase.from('vendas').insert([novaVenda]);
            processarEmailsVenda(novaVenda).catch(console.error);
        }
    }
    res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send("API Lust Store: ONLINE 💎"));
app.get('/taxas', async (req, res) => { const { data } = await supabase.from('taxas_iva').select('*'); res.json(data || []); });
app.get('/config', async (req, res) => { const { data } = await supabase.from('config_loja').select('*').single(); res.json(data || {}); });
app.put('/config', async (req, res) => { const { error } = await supabase.from('config_loja').upsert({ id: 1, ...req.body }); if (error) return res.status(500).json({ error: error.message }); res.json({ success: true }); });
app.get('/pedido/:codigo', async (req, res) => { const { codigo } = req.params; const { data, error } = await supabase.from('vendas').select('*').eq('codigo_pedido', codigo).single(); if (error || !data) return res.status(404).json({ erro: 'Pedido não encontrado' }); res.json(data); });
app.get('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').select('*').order('id', { ascending: true }); res.json(data || []); });
app.post('/produtos', async (req, res) => { const { data } = await supabase.from('produtos').insert([req.body]).select(); res.json(data ? data[0] : null); });
app.put('/produtos/:id', async (req, res) => { const b = {...req.body}; delete b.id; delete b.created_at; const { data } = await supabase.from('produtos').update(b).eq('id', req.params.id).select(); res.json(data ? data[0] : null); });
app.delete('/produtos/:id', async (req, res) => { await supabase.from('produtos').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/vendas', async (req, res) => { const { data } = await supabase.from('vendas').select('*').order('data_venda', { ascending: false }); res.json(data || []); });
app.post('/login-admin', (req, res) => { const { senha } = req.body; if (senha === (process.env.SENHA_ADMIN || 'admin2026')) res.json({ sucesso: true, token: 'logado_sucesso_servidor' }); else res.status(401).json({ sucesso: false }); });

// --- CHECKOUT COM PREÇO DINÂMICO ---
app.post('/checkout', async (req, res) => {
    try {
        const { itens, pais } = req.body;
        const novoIdPedido = gerarIdLust(); 
        
        // 1. Determinar Taxa
        const { data: taxaData } = await supabase.from('taxas_iva').select('taxa_percentual').eq('pais_iso', pais).single();
        const taxa = taxaData ? taxaData.taxa_percentual : 23; // Padrão 23% se não encontrar

        // 2. Determinar Frete e Isenção
        const { data: config } = await supabase.from('config_loja').select('*').single();
        const cf = config || { pt_std: 4.50, pt_exp: 8.00, pt_free: 60, es_std: 5.95, es_exp: 9.95, es_free: 85, eu_std: 12.50, eu_exp: 25.00, eu_free: 125 };

        // 3. Calcular Total para Frete (Baseado no preço COM imposto, geralmente isenção é sobre total)
        let totalBase = 0;
        let totalComImposto = 0;

        const line_items = itens.map(i => { 
            const precoBase = parseFloat(i.preco);
            const precoFinal = precoBase * (1 + (taxa / 100)); // PREÇO DINÂMICO: BASE + IMPOSTO
            totalBase += precoBase;
            totalComImposto += precoFinal;

            return { 
                price_data: { 
                    currency: 'eur', 
                    product_data: { name: `[${i.sku || '?'}] ${i.nome} (Taxa ${taxa}%)` }, 
                    unit_amount: Math.round(precoFinal * 100) // Stripe aceita cêntimos
                }, 
                quantity: 1 
            }; 
        });

        // 4. Configurar Frete Stripe
        let s_options = [];
        let allowed_countries = [];

        if (pais === 'PT') {
            allowed_countries = ['PT'];
            s_options = [
                { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: totalComImposto >= cf.pt_free ? 0 : Math.round(cf.pt_std * 100), currency: 'eur' }, display_name: 'Portugal: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 4 } } } },
                { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: Math.round(cf.pt_exp * 100), currency: 'eur' }, display_name: 'Portugal: Expresso', delivery_estimate: { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 2 } } } }
            ];
        } else if (pais === 'ES') {
            allowed_countries = ['ES'];
            s_options = [
                { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: totalComImposto >= cf.es_free ? 0 : Math.round(cf.es_std * 100), currency: 'eur' }, display_name: 'Espanha: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 5 } } } },
                { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: Math.round(cf.es_exp * 100), currency: 'eur' }, display_name: 'Espanha: Expresso', delivery_estimate: { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 2 } } } }
            ];
        } else {
            allowed_countries = ['FR', 'DE', 'IT', 'NL', 'BE', 'LU', 'IE', 'AT'];
            s_options = [
                { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: totalComImposto >= cf.eu_free ? 0 : Math.round(cf.eu_std * 100), currency: 'eur' }, display_name: 'Europa: Normal', delivery_estimate: { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 10 } } } },
                { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: Math.round(cf.eu_exp * 100), currency: 'eur' }, display_name: 'Europa: Expresso', delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 3 } } } }
            ];
        }

        const session = await stripe.checkout.sessions.create({ 
            payment_method_types: ['card'], 
            shipping_address_collection: { allowed_countries: allowed_countries }, 
            shipping_options: s_options, 
            line_items: line_items, 
            mode: 'payment', 
            success_url: `https://helderalex-hub.github.io/projeto-loja/sucesso.html?pedido=${novoIdPedido}`, 
            cancel_url: 'https://helderalex-hub.github.io/projeto-loja/loja.html', 
            metadata: { ids_produtos: itens.map(i => i.id).join(','), codigo_pedido: novoIdPedido, pais_destino: pais, taxa_aplicada: taxa } 
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta ${PORT}`));
