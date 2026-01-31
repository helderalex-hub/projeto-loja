<!DOCTYPE html>
<html lang="pt-PT">
<head>
    <meta charset="UTF-8">
    <title>Gestão Pro | Beleza & Companhia</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <style>
        :root { --dark-bg: #1a1a1a; --card-bg: #2d2d2d; --rosa: #d63384; --texto: #f5f5f5; --verde: #28a745; }
        body { font-family: 'Segoe UI', sans-serif; background-color: var(--dark-bg); color: var(--texto); margin: 0; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        h1 { color: var(--rosa); text-align: center; letter-spacing: 2px; }
        .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .card-dash { background: var(--card-bg); padding: 20px; border-radius: 12px; text-align: center; border: 1px solid #444; }
        .card-dash p { font-size: 22px; font-weight: bold; color: var(--rosa); margin: 10px 0 0; }
        .card-form { background: var(--card-bg); padding: 25px; border-radius: 15px; border: 1px solid #444; margin-bottom: 30px; }
        input { width: 100%; padding: 12px; margin-top: 5px; border-radius: 8px; border: 1px solid #444; background: #111; color: white; box-sizing: border-box; }
        button#btnSalvar { background: var(--rosa); color: white; border: none; padding: 15px; width: 100%; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 20px; }
        .item { background: var(--card-bg); padding: 15px; margin-top: 10px; border-radius: 10px; display: flex; align-items: center; gap: 15px; border: 1px solid #444; }
        .img-preview { width: 60px; height: 60px; border-radius: 8px; object-fit: cover; }
        .info { flex-grow: 1; }
        .btn-del { background: #ff4444; color: white; border: none; padding: 10px; border-radius: 8px; cursor: pointer; }
    </style>
</head>
<body>

    <div class="container">
        <h1>💎 Beleza & Companhia | Admin</h1>
        
        <div class="dashboard">
            <div class="card-dash"><h3>Stock Total</h3><p id="dash-qtd">0</p></div>
            <div class="card-dash"><h3>Lucro Previsto</h3><p id="dash-lucro" style="color:var(--verde)">€ 0.00</p></div>
            <div class="card-dash"><h3>Margem Média</h3><p id="dash-margem">0%</p></div>
        </div>

        <div class="card-form">
            <input type="text" id="nome" placeholder="Nome do Produto">
            <input type="number" id="preco_entrada" placeholder="Preço de Custo (€)">
            <input type="number" id="preco" placeholder="Preço de Venda (€)">
            <input type="number" id="estoque" placeholder="Quantidade">
            <input type="file" id="foto" accept="image/*">
            <button id="btnSalvar">CADASTRAR PRODUTO</button>
        </div>

        <div id="lista">Carregando dados...</div>
    </div>

    <script>
        const API = 'https://projeto-loja-dzqv.onrender.com/produtos';
        const S_URL = 'https://sgamfzcgiexoevnyiehn.supabase.co';
        const S_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnYW1memNnaWV4b2V2bnlpZWhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MzIwMDYsImV4cCI6MjA4NDUwODAwNn0.BLdnOWXEpW6w_Ic_0stcOexXXQBWl7Rc5ll0ATjvZVs';
        
        const supabaseClient = window.supabase.createClient(S_URL, S_KEY);

        // Função para carregar dados de forma limpa
        async function carregarDados() {
            try {
                const res = await fetch(API);
                const produtos = await res.json();
                const div = document.getElementById('lista');
                div.innerHTML = '';

                let totalQtd = 0, lucroTotal = 0, somaMargens = 0;

                produtos.forEach(p => {
                    const custo = parseFloat(p.preco_entrada || 0);
                    const venda = parseFloat(p.preco || 0);
                    const qtd = parseInt(p.estoque || 0);
                    const lucro = (venda - custo) * qtd;
                    const margem = venda > 0 ? ((venda - custo) / venda) * 100 : 0;

                    totalQtd += qtd;
                    lucroTotal += lucro;
                    somaMargens += margem;

                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'item';
                    itemDiv.innerHTML = `
                        <img src="${p.imagem || 'https://via.placeholder.com/60'}" class="img-preview">
                        <div class="info">
                            <strong>${p.nome}</strong>
                            <p>Custo: €${custo.toFixed(2)} | Venda: €${venda.toFixed(2)} | Stock: ${qtd}</p>
                            <p style="color:var(--verde)">Margem: ${margem.toFixed(1)}%</p>
                        </div>
                    `;
                    
                    const btnDel = document.createElement('button');
                    btnDel.innerText = '🗑️';
                    btnDel.className = 'btn-del';
                    btnDel.addEventListener('click', () => deletar(p.id));
                    
                    itemDiv.appendChild(btnDel);
                    div.appendChild(itemDiv);
                });

                document.getElementById('dash-qtd').innerText = totalQtd;
                document.getElementById('dash-lucro').innerText = '€ ' + lucroTotal.toFixed(2);
                document.getElementById('dash-margem').innerText = (produtos.length > 0 ? (somaMargens / produtos.length).toFixed(1) : 0) + '%';
            } catch (e) { console.error("Erro no fetch:", e); }
        }

        // Função para salvar sem usar onclick no HTML
        document.getElementById('btnSalvar').addEventListener('click', async () => {
            const btn = document.getElementById('btnSalvar');
            const nome = document.getElementById('nome').value;
            const custo = document.getElementById('preco_entrada').value;
            const venda = document.getElementById('preco').value;
            const estoque = document.getElementById('estoque').value;
            const arquivo = document.getElementById('foto').files[0];

            if(!nome || !venda) return alert("Preencha Nome e Preço!");
            btn.innerText = "Processando...";
            btn.disabled = true;

            let urlImg = "";
            if(arquivo) {
                const nomeArq = `${Date.now()}_${arquivo.name.replace(/\s/g, '_')}`;
                const { data, error } = await supabaseClient.storage.from('fotos-produtos').upload(nomeArq, arquivo);
                if(!error) {
                    const { data: l } = supabaseClient.storage.from('fotos-produtos').getPublicUrl(nomeArq);
                    urlImg = l.publicUrl;
                }
            }

            await fetch(API, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ nome, preco_entrada: custo, preco: venda, estoque, imagem: urlImg })
            });
            location.reload();
        });

        async function deletar(id) {
            if(confirm("Apagar produto?")) {
                await fetch(`${API}/${id}`, { method: 'DELETE' });
                carregarDados();
            }
        }

        window.addEventListener('load', carregarDados);
    </script>
</body>
</html>
