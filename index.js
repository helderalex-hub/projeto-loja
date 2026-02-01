const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

app.use(express.json());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get('/', (req, res) => res.send('✅ Servidor Beleza & Cia ON'));

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
    const body = { ...req.body };
    delete body.id; 
    delete body.created_at;
    const { data, error } = await supabase.from('produtos').update(body).eq('id', req.params.id).select();
    res.json(data ? data[0] : {error});
});

app.delete('/produtos/:id', async (req, res) => {
    await supabase.from('produtos').delete().eq('id', req.params.id);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Porta ${PORT}`));
