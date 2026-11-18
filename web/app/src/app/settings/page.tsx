'use client';

import { DatabaseBackup, Download, HardDrive, Languages, Lock, MonitorPlay, RefreshCw, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BackupError, cryptoAvailable, isValidPin, normalizeText } from '@tuitv/business-rules';
import type { AspectMode, BackupEnvelope, Language, Theme } from '@tuitv/shared-models';
import { MAX_BACKUP_BYTES, validateBackupEnvelope } from '@tuitv/validation';
import { ConfirmDialog, PinDialog } from '@/components/dialogs';
import { Button, Dropdown, Field, Input, Modal, Notice, PageHeader, Switch } from '@/components/ui';
import { storeCounts } from '@/lib/db';
import { download } from '@/lib/hooks';
import { formatBytes, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';

function Section({ id, icon, title, children }: { id?: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-line bg-surface">
      <h2 className="flex items-center gap-2 border-b border-line px-5 py-3 text-base font-bold">
        <span className="text-accent">{icon}</span> {title}
      </h2>
      <div className="divide-y divide-line/60">{children}</div>
    </section>
  );
}

function Item({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const resetSettings = useStore((s) => s.resetSettings);
  const clearCaches = useStore((s) => s.clearCaches);
  const deleteAllData = useStore((s) => s.deleteAllData);
  const toast = useStore((s) => s.toast);
  const [confirm, setConfirm] = useState<'reset' | 'wipe' | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t('Configurações')} subtitle={t('As preferências ficam guardadas apenas neste dispositivo.')} />

      <Section icon={<Languages className="size-5" />} title={t('Aparência e idioma')}>
        <Item title={t('Tema escuro')} hint={t('O tema escuro é o padrão do TuiTV.')}>
          <Switch checked={settings.theme === 'dark'} onChange={(dark) => update({ theme: (dark ? 'dark' : 'light') as Theme })} label={t('Tema escuro')} />
        </Item>
        <Item title={t('Idioma')}>
          <Dropdown<Language>
            label={t('Idioma')}
            value={settings.language}
            onChange={(language) => update({ language })}
            align="right"
            className="w-52"
            options={[
              { value: 'pt-BR', label: 'Português (Brasil)' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Item>
      </Section>

      <Section icon={<RefreshCw className="size-5" />} title={t('Listas e guias')}>
        <Item title={t('Atualização automática')} hint={t('Baixa de novo as listas e os guias adicionados por endereço quando ficam mais antigos que o intervalo escolhido. Favoritos e histórico são preservados.')}>
          <Dropdown
            label={t('Atualização automática')}
            value={settings.autoRefreshHours}
            onChange={(autoRefreshHours) => update({ autoRefreshHours })}
            align="right"
            className="w-48"
            options={[
              { value: 0, label: t('Desativada') },
              { value: 6, label: t('A cada {n} horas', { n: 6 }) },
              { value: 12, label: t('A cada {n} horas', { n: 12 }) },
              { value: 24, label: t('Uma vez por dia') },
              { value: 72, label: t('A cada {n} dias', { n: 3 }) },
              { value: 168, label: t('Uma vez por semana') },
            ]}
          />
        </Item>
      </Section>

      <Section icon={<MonitorPlay className="size-5" />} title={t('Reprodução')}>
        <Item title={t('Reprodução automática')} hint={t('Inicia a reprodução ao abrir um conteúdo e avança para o próximo episódio.')}>
          <Switch checked={settings.autoplay} onChange={(autoplay) => update({ autoplay })} label={t('Reprodução automática')} />
        </Item>
        <Item title={t('Reconexão automática')} hint={t('Tenta reconectar quando a transmissão cai.')}>
          <Switch checked={settings.autoReconnect} onChange={(autoReconnect) => update({ autoReconnect })} label={t('Reconexão automática')} />
        </Item>
        <Item title={t('Tempo limite de conexão')} hint={t('Vale para transmissões e para o download de listas e guias.')}>
          <Dropdown
            label={t('Tempo limite de conexão')}
            value={settings.connectionTimeout}
            onChange={(connectionTimeout) => update({ connectionTimeout })}
            align="right"
            className="w-40"
            options={[5, 10, 15, 30, 60].map((seconds) => ({ value: seconds, label: t('{n} segundos', { n: seconds }) }))}
          />
        </Item>
        <Item title={t('Idioma de áudio preferido')} hint={t('Usado quando a transmissão oferece mais de uma faixa.')}>
          <LanguageSelect value={settings.audioLanguage} onChange={(audioLanguage) => update({ audioLanguage })} label={t('Idioma de áudio preferido')} />
        </Item>
        <Item title={t('Legendas')} hint={t('Ativa as legendas automaticamente quando disponíveis.')}>
          <Switch checked={settings.subtitlesEnabled} onChange={(subtitlesEnabled) => update({ subtitlesEnabled })} label={t('Legendas')} />
          <LanguageSelect value={settings.subtitleLanguage} onChange={(subtitleLanguage) => update({ subtitleLanguage })} label={t('Idioma das legendas')} />
        </Item>
        <Item title={t('Proporção da imagem')}>
          <Dropdown<AspectMode>
            label={t('Proporção da imagem')}
            value={settings.aspect}
            onChange={(aspect) => update({ aspect })}
            align="right"
            className="w-60"
            options={[
              { value: 'contain', label: t('Ajustar (original)') },
              { value: 'cover', label: t('Preencher (corta as bordas)') },
              { value: 'fill', label: t('Esticar') },
            ]}
          />
        </Item>
      </Section>

      <Parental />

      <Section icon={<ShieldCheck className="size-5" />} title={t('Privacidade e rede')}>
        <Item
          title={t('Permitir endereços da rede local')}
          hint={t('Por segurança, o TuiTV recusa baixar listas e guias de endereços internos (localhost, 192.168.x.x…). Ative apenas se você usa um servidor na sua própria rede.')}
        >
          <Switch checked={settings.allowPrivateHosts} onChange={(allowPrivateHosts) => update({ allowPrivateHosts })} label={t('Permitir endereços da rede local')} />
        </Item>
        <div className="px-5 py-3.5 text-xs leading-relaxed text-muted">
          {t('O TuiTV não tem contas, cadastro, login, telemetria nem sincronização em nuvem. Listas, favoritos e histórico nunca são enviados a servidores do TuiTV. As únicas conexões feitas são às fontes que você mesmo importar.')}
        </div>
      </Section>

      <Storage />
      <Backup />

      <Section icon={<Trash2 className="size-5" />} title={t('Dados')}>
        <Item title={t('Limpar cache')} hint={t('Remove arquivos temporários da interface, programação antiga do guia e marcações de canais indisponíveis.')}>
          <Button
            onClick={async () => {
              await clearCaches();
              toast(t('Cache limpo.'), 'success');
            }}
          >
            {t('Limpar cache')}
          </Button>
        </Item>
        <Item title={t('Restaurar configurações')} hint={t('Volta as preferências ao padrão. Listas, favoritos e histórico são mantidos.')}>
          <Button onClick={() => setConfirm('reset')}>
            <RotateCcw className="size-4" /> {t('Restaurar')}
          </Button>
        </Item>
        <Item title={t('Excluir todos os dados')} hint={t('Apaga listas, favoritos, histórico, guias e configurações deste dispositivo. Não pode ser desfeito.')}>
          <Button variant="danger" onClick={() => setConfirm('wipe')}>
            <Trash2 className="size-4" /> {t('Excluir tudo')}
          </Button>
        </Item>
      </Section>

      <p className="pb-4 text-center text-xs text-muted">TuiTV Web 0.1.0 · {t('Seu entretenimento em um só lugar.')}</p>

      {confirm === 'reset' && (
        <ConfirmDialog
          title={t('Restaurar configurações')}
          message={t('As preferências voltarão ao padrão.')}
          confirmLabel={t('Restaurar')}
          onConfirm={() => {
            resetSettings();
            toast(t('Configurações restauradas.'), 'success');
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'wipe' && (
        <ConfirmDialog
          title={t('Excluir todos os dados')}
          message={t('Todas as listas, favoritos, histórico, guias e configurações serão apagados deste dispositivo. Esta ação não pode ser desfeita. Considere exportar um backup antes.')}
          confirmLabel={t('Excluir tudo')}
          danger
          onConfirm={async () => {
            await deleteAllData();
            toast(t('Todos os dados locais foram excluídos.'), 'success');
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function LanguageSelect({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const t = useT();
  return (
    <Dropdown
      label={label}
      value={value}
      onChange={onChange}
      align="right"
      className="w-52"
      options={[
        { value: '', label: t('Padrão da transmissão') },
        { value: 'pt', label: 'Português' },
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Español' },
        { value: 'fr', label: 'Français' },
        { value: 'it', label: 'Italiano' },
        { value: 'de', label: 'Deutsch' },
        { value: 'ja', label: '日本語' },
      ]}
    />
  );
}

/* ── Controle parental ─────────────────────────────────────────────────── */
function Parental() {
  const t = useT();
  const parental = useStore((s) => s.settings.parental);
  const unlocked = useStore((s) => s.parentalUnlocked);
  const allGroups = useStore((s) => s.lib.allGroups);
  const hidden = useStore((s) => s.lib.hiddenCount);
  const update = useStore((s) => s.updateSettings);
  const setPin = useStore((s) => s.setPin);
  const disableParental = useStore((s) => s.disableParental);
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pin, setPinValue] = useState('');
  const [again, setAgain] = useState('');
  const canEdit = !parental.enabled || unlocked;
  const locked = new Set(parental.lockedGroups);

  const toggleGroup = (group: string) => {
    const key = normalizeText(group);
    const next = new Set(locked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update({ parental: { ...parental, lockedGroups: [...next] } });
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidPin(pin) || pin !== again) return;
    await setPin(pin);
    setCreating(false);
    setPinValue('');
    setAgain('');
  };

  return (
    <Section icon={<Lock className="size-5" />} title={t('Controle parental')}>
      <Item
        title={parental.enabled ? t('Controle parental ativo') : t('Controle parental desativado')}
        hint={
          parental.enabled
            ? t('{n} itens ocultos. Categorias bloqueadas não aparecem nas telas nem na busca até o PIN ser informado.', { n: hidden.toLocaleString() })
            : t('Defina um PIN para ocultar categorias. O PIN fica guardado apenas neste dispositivo, de forma irreversível.')
        }
      >
        {!parental.enabled ? (
          <Button variant="primary" onClick={() => setCreating(true)} disabled={!cryptoAvailable()}>
            {t('Definir PIN')}
          </Button>
        ) : unlocked ? (
          <>
            <Button onClick={() => setCreating(true)}>{t('Alterar PIN')}</Button>
            <Button variant="danger" onClick={disableParental}>
              {t('Desativar')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => setAsking(true)}>
            {t('Desbloquear para alterar')}
          </Button>
        )}
      </Item>
      {!cryptoAvailable() && (
        <div className="px-5 py-3">
          <Notice tone="warning">{t('Este recurso exige que o TuiTV seja aberto em um endereço seguro (https).')}</Notice>
        </div>
      )}
      {canEdit && (
        <>
          <Item title={t('Ocultar conteúdo adulto')} hint={t('Oculta automaticamente categorias identificadas como adultas (por exemplo “Adultos”, “+18”, “XXX”).')}>
            <Switch checked={parental.hideAdult} onChange={(hideAdult) => update({ parental: { ...parental, hideAdult } })} label={t('Ocultar conteúdo adulto')} />
          </Item>
          {allGroups.length > 0 && (
            <div className="px-5 py-3.5">
              <p className="text-sm font-medium">{t('Categorias bloqueadas')}</p>
              <p className="mt-0.5 text-xs text-muted">{t('Marque as categorias que devem exigir o PIN.')}</p>
              <div className="mt-3 grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-line bg-bg p-2 sm:grid-cols-2">
                {allGroups.map((group) => (
                  <label key={group} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface">
                    <input type="checkbox" className="size-4 accent-[var(--tui-accent)]" checked={locked.has(normalizeText(group))} onChange={() => toggleGroup(group)} />
                    <span className="truncate">{group}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {creating && (
        <Modal title={parental.enabled ? t('Alterar PIN') : t('Definir PIN')} onClose={() => setCreating(false)}>
          <form onSubmit={create} className="space-y-4">
            <Field label={t('Novo PIN')} hint={t('De 4 a 8 dígitos.')}>
              <Input value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password" inputMode="numeric" autoComplete="off" name="new-pin" data-autofocus />
            </Field>
            <Field label={t('Repita o PIN')}>
              <Input value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password" inputMode="numeric" autoComplete="off" name="repeat-pin" />
            </Field>
            {again.length >= 4 && pin !== again && <Notice tone="danger">{t('Os PINs não coincidem.')}</Notice>}
            <Notice tone="warning">{t('Não há como recuperar um PIN esquecido: será preciso excluir todos os dados do aplicativo.')}</Notice>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreating(false)}>
                {t('Cancelar')}
              </Button>
              <Button variant="primary" type="submit" disabled={!isValidPin(pin) || pin !== again}>
                {t('Salvar')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {asking && <PinDialog onClose={() => setAsking(false)} />}
    </Section>
  );
}

/* ── Armazenamento ─────────────────────────────────────────────────────── */
function Storage() {
  const t = useT();
  const playlists = useStore((s) => s.playlists.length);
  const epgVersion = useStore((s) => s.epgVersion);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof storeCounts>> | null>(null);

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
    void navigator.storage?.persisted?.().then(setPersisted);
    void storeCounts().then(setCounts).catch(() => undefined);
  }, [playlists, epgVersion]);

  const ratio = estimate && estimate.quota > 0 ? estimate.usage / estimate.quota : 0;

  return (
    <Section icon={<HardDrive className="size-5" />} title={t('Armazenamento')}>
      <div className="px-5 py-3.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">{t('Espaço usado neste navegador')}</span>
          <span className="text-muted tabular-nums">{estimate ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}` : '—'}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg">
          <div className={ratio > 0.8 ? 'h-full bg-warning' : 'h-full bg-accent'} style={{ width: `${Math.max(1, ratio * 100)}%` }} />
        </div>
        {counts && (
          <p className="mt-2 text-xs text-muted">
            {t('{items} conteúdos · {programmes} programas do guia · {favorites} favoritos · {history} itens no histórico', {
              items: counts.items.toLocaleString(),
              programmes: counts.programmes.toLocaleString(),
              favorites: counts.favorites.toLocaleString(),
              history: counts.history.toLocaleString(),
            })}
          </p>
        )}
      </div>
      <Item
        title={t('Armazenamento persistente')}
        hint={
          persisted
            ? t('O navegador não apagará os dados do TuiTV automaticamente.')
            : t('Sem esta proteção, o navegador pode apagar os dados quando faltar espaço. Em janelas anônimas os dados são apagados ao fechar.')
        }
      >
        {persisted ? (
          <span className="text-sm font-semibold text-success">{t('Ativo')}</span>
        ) : (
          <Button onClick={() => void navigator.storage?.persist?.().then(setPersisted)} disabled={!navigator.storage?.persist}>
            {t('Solicitar')}
          </Button>
        )}
      </Item>
      <div className="px-5 py-3.5 text-xs text-muted">
        {t('Os dados pertencem a este navegador e a este perfil. Limpar os dados de navegação apaga a biblioteca do TuiTV — use o backup para preservá-la.')}
      </div>
    </Section>
  );
}

/* ── Backup e restauração (PRD §8.3) ───────────────────────────────────── */
function Backup() {
  const t = useT();
  const exportBackup = useStore((s) => s.exportBackup);
  const restoreBackup = useStore((s) => s.restoreBackup);
  const toast = useStore((s) => s.toast);
  const [exporting, setExporting] = useState(false);
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<BackupEnvelope | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const closeExport = () => {
    setExporting(false);
    setPassword('');
    setConsent(false);
    setNeedsConsent(false);
    setError(null);
  };

  const runExport = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { text, hasCredentials } = await exportBackup(password);
      // Credenciais nunca saem desprotegidas sem aviso e consentimento explícito.
      if (hasCredentials && !password && !consent) {
        setNeedsConsent(true);
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      download(`tuitv-backup-${stamp}.json`, text);
      toast(t('Backup exportado.'), 'success');
      closeExport();
    } catch (err) {
      setError(err instanceof BackupError && err.code === 'crypto-unavailable' ? t('A proteção por senha exige um endereço seguro (https).') : t('Não foi possível gerar o backup.'));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File) => {
    if (file.size > MAX_BACKUP_BYTES) {
      toast(t('O arquivo excede o tamanho máximo de importação.'), 'error');
      return;
    }
    const check = validateBackupEnvelope(await file.text());
    if (!check.ok) {
      const messages = {
        'not-json': t('O arquivo não é um backup do TuiTV.'),
        'not-tuitv': t('O arquivo não é um backup do TuiTV.'),
        'newer-version': t('Este backup foi criado por uma versão mais nova do TuiTV. Atualize o aplicativo.'),
        'invalid-structure': t('O arquivo de backup está corrompido ou incompleto.'),
      };
      toast(messages[check.problem!], 'error');
      return;
    }
    setRestorePassword('');
    setError(null);
    setRestore(check.envelope!);
  };

  const runRestore = async (event: FormEvent) => {
    event.preventDefault();
    if (!restore) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreBackup(restore, restorePassword || undefined);
      toast(
        result.pendingRefresh > 0
          ? t('Backup restaurado: {n} listas. Atualize as listas remotas em “Minhas listas” para baixar o conteúdo.', { n: result.playlists })
          : t('Backup restaurado: {n} listas.', { n: result.playlists }),
        'success',
      );
      setRestore(null);
    } catch (err) {
      const code = err instanceof BackupError ? err.code : 'invalid';
      setError(
        code === 'wrong-password' || code === 'password-required'
          ? t('Senha incorreta.')
          : code === 'crypto-unavailable'
            ? t('A proteção por senha exige um endereço seguro (https).')
            : t('O arquivo de backup está corrompido ou incompleto.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="backup" icon={<DatabaseBackup className="size-5" />} title={t('Backup e restauração')}>
      <Item title={t('Exportar backup')} hint={t('Salva suas listas, favoritos, histórico e preferências em um arquivo neste dispositivo.')}>
        <Button onClick={() => setExporting(true)}>
          <Download className="size-4" /> {t('Exportar')}
        </Button>
      </Item>
      <Item title={t('Restaurar backup')} hint={t('Importa um arquivo de backup do TuiTV, inclusive de outro dispositivo. Os dados atuais são mantidos.')}>
        <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" data-testid="backup-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} />
        <Button onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> {t('Restaurar')}
        </Button>
      </Item>

      {exporting && (
        <Modal title={t('Exportar backup')} onClose={closeExport}>
          <form onSubmit={runExport} className="space-y-4">
            <Field label={t('Senha (recomendada)')} hint={t('Com senha, o arquivo é cifrado (AES-256). Sem a senha não é possível restaurá-lo.')}>
              <Input value={password} onChange={(e) => { setPassword(e.target.value); setNeedsConsent(false); }} type="password" autoComplete="new-password" name="backup-password" disabled={!cryptoAvailable()} data-autofocus />
            </Field>
            {needsConsent && (
              <Notice tone="warning">
                <p>{t('Suas listas contêm credenciais ou tokens de acesso. Sem senha, eles serão gravados no arquivo em texto legível por qualquer pessoa que o abrir.')}</p>
                <label className="mt-2 flex items-center gap-2 font-semibold">
                  <input type="checkbox" className="size-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  {t('Entendo e quero exportar sem proteção')}
                </label>
              </Notice>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeExport}>
                {t('Cancelar')}
              </Button>
              <Button variant="primary" type="submit" disabled={busy || (needsConsent && !consent && !password)}>
                {t('Exportar')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {restore && (
        <Modal title={t('Restaurar backup')} onClose={() => setRestore(null)}>
          <form onSubmit={runRestore} className="space-y-4">
            <p className="text-sm text-muted">
              {t('Backup criado em {date} ({platform}).', { date: new Date(restore.createdAt).toLocaleString(), platform: restore.platform })}{' '}
              {t('Listas já existentes neste dispositivo não são duplicadas.')}
            </p>
            {restore.encrypted && (
              <Field label={t('Senha do backup')}>
                <Input value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} type="password" autoComplete="off" name="restore-password" data-autofocus />
              </Field>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRestore(null)}>
                {t('Cancelar')}
              </Button>
              <Button variant="primary" type="submit" disabled={busy || (restore.encrypted && !restorePassword)}>
                {t('Restaurar')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Section>
  );
}
