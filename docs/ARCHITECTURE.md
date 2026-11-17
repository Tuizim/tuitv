# Arquitetura

## Visão geral

Monorepo com dois ecossistemas que compartilham regras e arquivos de referência:

- **TypeScript** (pnpm + Turborepo): pacotes em `packages/*` consumidos direto do código-fonte pelo app `apps/web`.
- **Kotlin** (Gradle): `packages/kotlin-core`, Kotlin/JVM puro, base dos aplicativos Android e Android TV.

Não existe servidor. O navegador baixa as listas diretamente das fontes do usuário e grava tudo no IndexedDB.

```
Hospedagem estática ──► Navegador (aplicação inteira) ──► IndexedDB / Cache
                              │
                              └──► fontes do usuário (listas, guias, transmissões)
```

## Fluxo de importação

`net.ts` abre a fonte (download ou arquivo) → detecta gzip e codificação → `M3uParser.push()` interpreta em pedaços → `ItemBuilder` classifica e gera ids → `db.putItems()` grava em lotes de 2.000, com progresso. Nada exige o arquivo inteiro em memória como texto.

Validações antes de gravar: formato (`looksLikeM3u`), tamanho máximo, esquema do endereço e bloqueio de endereços internos (opcionalmente liberado nas Configurações).

## Identidade dos itens

`id = playlistId + ":" + chave`, em que a chave é um hash de `tvg-id + nome` (ou `nome + categoria` sem tvg-id). O endereço de reprodução não entra na chave, pois costuma mudar (tokens). Consequências:

- reimportar a mesma lista regrava os mesmos ids — atualização sem duplicação;
- favoritos e histórico sobrevivem a atualizações;
- registros repetidos recebem sufixo `-2`, `-3`… na ordem em que aparecem.

## Classificação de conteúdo

Ordem das regras: atributo `tvg-type` → caminho (`/series/`, `/movie/`, `/live/`) → extensão de vídeo (com marcação de episódio = série, senão filme) → marcação de episódio em categoria de séries → ao vivo. A categoria sozinha nunca decide, porque grupos como “Filmes e Séries” costumam conter canais ao vivo.

## Biblioteca em memória

No início, os itens das listas ativas são carregados do IndexedDB para uma estrutura em memória (`lib/library.ts`) já filtrada pelo controle parental e com índice de busca normalizado. Listas e grades são virtualizadas, então o DOM contém só o que está visível.

## Player Web

Estratégias em ordem: `.m3u8` → HLS.js (ou HLS nativo); arquivo de vídeo → HTML5; demais endereços → o formato é detectado pelo tipo de conteúdo e pelos primeiros bytes (HLS → HLS.js, MPEG-TS → mpegts.js, vídeo → HTML5). Se o servidor bloquear a detecção (CORS), o player tenta a variante HLS do canal (`.ts` → `.m3u8`, ou `/live/usuario/senha/id.m3u8`) e a reprodução nativa. Falhas de rede reconectam com espera crescente; ao desistir, o item é marcado como indisponível e a causa é explicada (erro HTTP, bloqueio de CORS, formato, tempo limite).

## Atualização automática

Listas e guias adicionados por endereço são baixados de novo quando ficam mais antigos que o intervalo definido em Configurações (padrão: um dia). A verificação ocorre ao abrir o aplicativo e a cada 30 minutos; uma falha não apaga a biblioteca anterior e só é repetida após uma hora.

## Interface

Barra de navegação superior (cinco destinos principais + menu com os demais), destaque na tela inicial e fileiras horizontais por categoria. Em Filmes e Séries, escolher uma categoria troca as fileiras por uma grade completa. No celular, a navegação fica em uma barra inferior.

## Segurança e privacidade

- Endereços de listas e guias são cifrados em repouso com AES-GCM e chave não extraível guardada no IndexedDB. Isso impede a leitura direta dos dados em disco, mas não protege contra código malicioso executando na própria página — por isso a CSP restringe scripts à própria aplicação.
- Os endereços de cada item (que também podem conter credenciais) **não** são cifrados individualmente, por custo de desempenho.
- Endereços nunca vão completos para o console (`maskUrl`).
- Requisições são feitas sem cookies e sem `Referer`.
- Backups com credenciais só saem sem senha após aviso e consentimento. O PIN parental nunca é exportado.
- O service worker guarda apenas arquivos da própria origem.

## Equivalência entre plataformas

`packages/m3u-parser/fixtures/*.m3u` são os arquivos de referência. O resultado canônico (`fixtures/expected/*.json`) é gerado pelo TypeScript (`pnpm fixtures:update`) e conferido tanto pelo Vitest quanto pelo JUnit do núcleo Kotlin. Um backup cifrado gerado pela Web (`fixtures/backup/`) também é restaurado pelo teste Kotlin.
