app.post('/produtos', async (req, res) => {
    try {
        const { nome, preco, preco_entrada, estoque, imagem } = req.body;

        // Validar se os dados mínimos existem
        if (!nome || !preco) {
            return res.status(400).json({ error: "Nome e Preço são obrigatórios" });
        }

        // Criar o objeto garantindo tipos numéricos
        const novoProduto = {
            nome: nome,
            preco: parseFloat(preco),
            preco_entrada: parseFloat(preco_entrada || 0),
            estoque: parseInt(estoque || 0),
            imagem: imagem || ""
        };

        const { data, error } = await supabase
            .from('produtos')
            .insert([novoProduto])
            .select();

        if (error) {
            console.error("Erro Supabase:", error);
            return res.status(400).json(error);
        }

        res.status(201).json(data[0]);
    } catch (err) {
        console.error("Erro Servidor:", err);
        res.status(500).json({ error: err.message });
    }
});
