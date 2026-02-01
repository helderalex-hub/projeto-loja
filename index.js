const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

// --- 1. CONFIGURAÇÃO MANUAL DE CORS (A CHAVE PARA O GERENTE) ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 2. ROTAS DA API ---

// Teste de vida (Abra no navegador para testar)
app.get('/', (req, res) => res.send('✅ Servidor Beleza & Cia ON (projeto-loja-dzqv)'));

// Listar Produtos
app.get('/produtos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('produtos').select('*').order('id', { ascending: true });
        if (error) throw error;
        res.status(200).json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Adicionar Produto
app.post('/produtos', async (req, res) => {
    const { data, error } = await supabase.from('produtos').insert([req.body]).select();
    if (error) return res.status(400).json(error);
    res.status(201).json(data[0]);
});

// Editar Produto
app.put('/produtos/:id', async (req, res) => {
    const body = { ...req.body };
    delete body.id; 
    delete body.created_at;
    const { data, error } = await supabase.from('produtos').update(body).eq('id', req.params.id).select();
    if (error) return res.status(400).json(error);
    res.json(data[0]);
});

// Eliminar Produto
app.delete('/produtos/:id', async (req, res) => {
    const { error } = await supabase.from('produtos').delete().eq('id', req.params.id);
    if (error) return res.status(400).json(error);
    res.json({ message: "Eliminado com sucesso" });
});

// --- 3. INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
