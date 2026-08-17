# Family Finance Hub

Crie uma aplicação SaaS de inteligência financeira familiar chamada provisoriamente "Família Finance AI".

O objetivo do sistema é ajudar famílias a controlar, entender e melhorar sua vida financeira através de uma visão completa de receitas, despesas, cartões, contas, metas e comportamento de consumo.

IMPORTANTE:

Não crie apenas um controle de gastos simples.

A arquitetura deve ser preparada para futuramente receber inteligência artificial capaz de analisar hábitos financeiros, sugerir economias, prever gastos e recomendar decisões.

Tecnologias:

- React

- TypeScript

- Tailwind CSS

- Supabase para autenticação e banco de dados

- Interface responsiva para desktop e mobile

FASE ATUAL:

Criar somente a fundação do sistema.

Implementar:

1. SISTEMA DE AUTENTICAÇÃO

Criar:

- Cadastro de usuário

- Login

- Recuperação de senha

- Sessão persistente

Campos do usuário:

- id

- nome completo

- email

- telefone opcional

- created_at

2. ESTRUTURA FAMILIAR

Um usuário poderá criar uma família.

Criar tabela:

families

Campos:

- id

- nome_da_familia

- created_at

- owner_id

Criar tabela:

family_members

Campos:

- id

- family_id

- user_id

- nome

- relacionamento

- permissao

Permissões:

ADMIN:

Pode alterar tudo.

MEMBER:

Pode adicionar informações e visualizar.

VIEWER:

Somente visualização.

3. PERFIL FINANCEIRO INICIAL

Criar estrutura para armazenar informações básicas:

Tabela:

financial_profiles

Campos:

- id

- family_id

- quantidade_dependentes

- objetivo_principal

- renda_principal

- possui_renda_variavel

- created_at

Objetivos:

- organizar_financas

- sair_de_dividas

- economizar

- comprar_bem

- investir

4. ESTRUTURA DE NAVEGAÇÃO INICIAL

Criar layout principal após login.

Menu:

Dashboard

Minha Família

Perfil Financeiro

Configurações

5. PADRÃO VISUAL

Criar uma interface premium.

Características:

- aparência moderna;

- limpa;

- confiável;

- familiar;

- fácil para pessoas sem conhecimento financeiro.

Inspirar-se em:

- Nubank pela simplicidade;

- Apple pela clareza;

- Notion pela organização.

Usar cards, gráficos futuramente e bastante espaço visual.

6. REGRAS IMPORTANTES

Preparar arquitetura para futuras tabelas:

- receitas;

- despesas;

- cartões;

- contas fixas;

- compras;

- produtos;

- metas;

- análises financeiras;

- recomendações IA.

Não criar dados fictícios.

Não criar funcionalidades futuras ainda.

Priorizar uma base limpa, escalável e organizada.

Antes de criar qualquer tela complexa, valide a estrutura do banco de dados e a arquitetura.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/013d4275-e95f-498f-8449-13f00d0ccb3d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
