# 🍺 Simbora Food Park — Guia de Configuração Completo

## Arquivos do Projeto
```
simbora-foodpark/
├── index.html       ← Shell da aplicação
├── style.css        ← Estilos (tema dark warm industrial)
├── script.js        ← Lógica completa
├── sw.js            ← Service Worker (PWA/Offline)
├── manifest.json    ← Configuração PWA
└── setup-supabase.sql ← Schema completo do banco
```

---

## PASSO 1 — Criar projeto Supabase

1. Acesse https://app.supabase.com e crie um **novo projeto** (ex: `simbora-foodpark`)
2. Aguarde o projeto inicializar (~1 min)
3. Vá em **SQL Editor** → **New Query**
4. Cole o conteúdo de `setup-supabase.sql` e execute (Run)
5. Vá em **Project Settings → API** e copie:
   - `Project URL`  → vai no `Config.SB_URL` em script.js
   - `anon public`  → vai no `Config.SB_KEY` em script.js

### Criar usuário sócio
No Supabase → **Authentication → Users → Add User**:
- Email: socio1@simborafoodpark.com
- Senha: (defina uma segura)
- Repita para o segundo sócio

Depois, no **SQL Editor**, execute:
```sql
UPDATE public.profiles 
SET role = 'socio' 
WHERE email IN ('socio1@simborafoodpark.com', 'socio2@simborafoodpark.com');
```

---

## PASSO 2 — Configurar Cloudinary

1. Crie conta gratuita em https://cloudinary.com (25GB grátis)
2. No painel: **Settings → Upload → Upload presets → Add Upload Preset**
   - Preset name: `simbora-comprovantes`
   - Signing mode: **Unsigned** ✅
   - Folder: `simbora-foodpark`
   - Allowed formats: `jpg,jpeg,png,webp,pdf`
   - Max file size: 10 MB
3. Salve e copie o **Cloud Name** (está no dashboard, canto superior esquerdo)

### No script.js, preencha o Config:
```javascript
const Config = {
  SB_URL:            'https://XXXXXXXXXXXX.supabase.co',
  SB_KEY:            'eyJhbGciOiJIUzI1NiIsInR5c...',
  CLOUDINARY_CLOUD:  'meu-cloud-name',        // ← Cloud Name
  CLOUDINARY_PRESET: 'simbora-comprovantes',  // ← nome do preset
  // ... resto mantém
};
```

---

## PASSO 3 — Fazer deploy (hospedagem)

### Opção A — Netlify (recomendado, gratuito)
1. Acesse https://netlify.com → **Add new site → Deploy manually**
2. Arraste a pasta do projeto para o campo de upload
3. Sua URL será algo como `simbora-foodpark.netlify.app`
4. Opcional: configure domínio próprio

### Opção B — Vercel
1. Acesse https://vercel.com → **Add New → Project**
2. Importe a pasta ou conecte ao GitHub

### Opção C — GitHub Pages
1. Crie repositório privado e suba os arquivos
2. Settings → Pages → Source: main branch / root

---

## PASSO 4 — Verificar RLS (Row Level Security)

O schema já configura RLS automaticamente. Verifique no Supabase:
- **Table Editor → transacoes → Policies** — deve ter 4 políticas
- **Authentication → Policies** — todas as tabelas devem ter RLS ativo

---

## Funcionalidades Implementadas

### ✅ Autenticação completa
- Login com e-mail + senha
- 3 roles: `admin`, `socio` (editar/lançar), `viewer` (só leitura)
- Logout com um toque
- RLS: banco de dados bloqueado para não autenticados

### ✅ Movimentações
- **Receitas**: com fonte (Restaurante, Bar, Aluguel Box A/B/C, Ingressos…)
- **Despesas**: com categoria (Fornecedores, Energia, IVA, Funcionários…)
- Moedas: PYG, BRL, USD (conversão automática para ₲ em exibição)
- Parcelamento (até 60x com preview de datas)
- IVA: campo separado com cálculo automático de base e percentual
- Método de pagamento: Efectivo, Transferência, Cartão, Pix, Cheque

### ✅ Comprovantes via Cloudinary
- Upload de foto (câmera ou galeria) ou PDF diretamente do celular
- Visualização inline na lista (imagem preview / ícone PDF)
- Download com nome original preservado
- Preview no modal de edição com botão de remover
- 25GB gratuitos, sem risco de estouro

### ✅ Receitas Futuras
- Planejamento de receitas esperadas (aluguéis fixos, eventos)
- Status: ESPERADO → CONFIRMADO → REALIZADO / CANCELADO
- Recorrência: Semanal, Mensal, Anual
- Botão "Realizar": abre modal pré-preenchido
- Exibidas no dashboard como "Receitas Previstas"

### ✅ Despesas Recorrentes
- Templates de despesas mensais (Energia, Água, Funcionários…)
- Botão "Gerar este mês": cria transação pendente com um toque
- Pausar/Ativar sem excluir
- Controle de última geração

### ✅ Dashboard executivo
- KPIs: Receitas, Despesas, Resultado (com sinal +/−)
- Gráfico doughnut: Receitas por Fonte
- Gráfico doughnut: Despesas por Categoria
- Barra de conciliação (X/Y conciliados)
- Próximas receitas previstas
- Últimas 6 movimentações

### ✅ Offline First
- Service Worker v1.0 com cache inteligente
- Fila offline persistida no localStorage
- Sincronização automática ao reconectar
- Banner com contador de operações pendentes

### ✅ PWA
- Instalável no Android e iOS
- Funciona offline (leitura + lançamentos em fila)
- Tema dark com meta-color adequado

### ✅ Impressão/PDF
- Relatório formatado com totais, gráficos e tabela completa
- Filtros aplicados (tipo, busca)
- Câmbio snapshottado no momento da impressão

---

## Fluxo de Uso Diário

### Lançar receita do restaurante
1. Toque no **+** verde → selecione Fonte: Restaurante → valor em PYG → Salvar

### Lançar conta de energia com comprovante
1. Toque no **−** vermelho → categoria: Energia Elétrica → valor → IVA → toque em "Escolher arquivo" → selecione o PDF → Salvar
2. O PDF vai para o Cloudinary e fica disponível na lista com ícone 📎

### Gerar despesas recorrentes do mês
1. Tab **Recorrentes** → toque em "Gerar este mês" em cada template

### Conferir receitas de aluguel
1. Tab **Previstas** → visualize os status → toque em "Realizar" quando o pagamento entrar

---

## Bugs Corrigidos (vs. app anterior)
1. ✅ **Autenticação**: agora exige login — sem mais acesso livre pela URL
2. ✅ **RLS**: políticas por role (socio/viewer) no nível do banco
3. ✅ **Câmbio histórico**: taxa snapshot salva em `taxa_cambio_brl_pyg/usd_pyg` por transação
4. ✅ **Status dívida**: removido — substituído por `status` unificado (CONCLUIDO/PENDENTE/CANCELADO)
5. ✅ **Multi-usuário**: campo `criado_por` + `conciliado_por` rastreiam quem fez o quê

---

## Customização das Fontes e Categorias

No Supabase → **Table Editor → fontes_receita** ou **categorias_despesa**:
- Adicione linhas para novas fontes/categorias
- O app carrega automaticamente ao iniciar
- Use emojis no campo `icone` para exibição visual

---

## Suporte a Novos Sócios

Para adicionar um novo usuário:
1. **Supabase → Authentication → Users → Add User**
2. Execute no SQL Editor:
```sql
UPDATE public.profiles SET role = 'socio' WHERE email = 'novo@email.com';
-- ou para só visualizar:
UPDATE public.profiles SET role = 'viewer' WHERE email = 'novo@email.com';
```
