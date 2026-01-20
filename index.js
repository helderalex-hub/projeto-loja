require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cors());

// Conexão com o Banco de Dados
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Adicionado para garantir conexão segura na nuvem
});

// 1. Rota para LISTAR produtos
app.get('/produtos', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
        res.json(resultado.rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: erro.message });
    }
});

// 2. Rota para CADASTRAR produto
app.post('/produtos', async (req, res) => {
    try {
        const { nome, preco, estoque, validade } = req.body;
        const query = 'INSERT INTO produtos (nome, preco, estoque, validade) VALUES ($1, $2, $3, $4) RETURNING *';
        const values = [nome, preco, estoque, validade];
        const resultado = await pool.query(query, values);
        res.json(resultado.rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: erro.message });
    }
});

// 3. Rota para ATUALIZAR (Preço e Estoque)
app.put('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { preco, estoque } = req.body;
        const query = 'UPDATE produtos SET preco = $1, estoque = $2 WHERE id = $3';
        await pool.query(query, [preco, estoque, id]);
        res.json({ message: "Produto atualizado!" });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: erro.message });
    }
});

// 4. Rota para DELETAR
app.delete('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
        res.json({ message: "Deletado!" });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: erro.message });
    }
});

// --- AQUI ESTÁ A MUDANÇA IMPORTANTE PARA A NUVEM ---
// O servidor vai usar a porta que a nuvem der (process.env.PORT) OU a 3000 se for local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});