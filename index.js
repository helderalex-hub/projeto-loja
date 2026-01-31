app.post('/produtos', async (req, res) => {
    try {
        const { nome, preco, preco_entrada, estoque, validade, imagem } = req.body;
        
        // Criamos o objeto de forma limpa
        const dadosParaSalvar = {
            nome: nome,
            preco: parseFloat(preco) || 0,
            preco_entrada: parseFloat(preco_entrada || 0),
            estoque: parseInt(estoque || 0),
            validade: validade && validade !== "" ? validade : null,
            imagem: imagem || null
        };

        const { data, error } = await supabase
            .from('produtos')
            .insert([dadosParaSalvar])
            .select();
        
        if (error) {
            console.error("Erro Supabase:", error);
            return res.status(400).json({ error: error.message });
        }
        
        res.status(201).json(data[0]);
    } catch (err) {
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});
