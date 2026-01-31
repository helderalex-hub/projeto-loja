// Rota para Atualizar (Editar) - FORÇANDO NÚMEROS
app.put('/produtos/:id', async (req, res) => {
    const { nome, preco, preco_entrada, estoque, imagem } = req.body;
    
    const { data, error } = await supabase
        .from('produtos')
        .update({
            nome,
            preco: parseFloat(preco),
            preco_entrada: parseFloat(preco_entrada || 0),
            estoque: parseInt(estoque || 0),
            imagem
        })
        .eq('id', req.params.id);

    if (error) return res.status(400).json(error);
    res.json({ message: "Atualizado com sucesso" });
});

// Rota para Criar (Post) - FORÇANDO NÚMEROS
app.post('/produtos', async (req, res) => {
    const { nome, preco, preco_entrada, estoque, imagem } = req.body;

    const { data, error } = await supabase
        .from('produtos')
        .insert([{
            nome,
            preco: parseFloat(preco),
            preco_entrada: parseFloat(preco_entrada || 0),
            estoque: parseInt(estoque || 0),
            imagem
        }]);

    if (error) return res.status(400).json(error);
    res.status(201).json({ message: "Criado com sucesso" });
});
