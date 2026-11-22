import { Badge, CommandList, CommandRow, RiskMark } from '@design-system/react';
import type { CommandRun } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { commandMarks } from '../model/marks';

/** Shown at most (the latest); the transcript keeps up to 500. */
const SHOWN = 200;

/** In the app's language, not the system's (an English UI on a Korean Mac must not read "오후 10:48"). */
const clock = (at: number | undefined, locale: string) =>
  at === undefined ? undefined : new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/**
 * Commands a Claude session ran (T59), oldest first: how each ended, the command (secrets already masked by main),
 * ⚠ for destructive ones (T52), badges for tests and migrations, and the time. Output is never shown.
 */
export default function CommandTimeline({ commands }: { commands: CommandRun[] }) {
  const t = useT();
  const shown = commands.slice(-SHOWN);
  return (
    <CommandList label={t('commands.title')}>
      {shown.map((c, i) => {
        const marks = commandMarks(c.command);
        return (
          <CommandRow
            key={i}
            state={c.state}
            stateLabel={t(`commands.state.${c.state}`)}
            command={c.command}
            time={clock(c.at, t('locale'))}
            marks={
              marks.length > 0 && (
                <>
                  {marks.includes('destructive') && <RiskMark label={t('attention.risky')} />}
                  {marks.includes('test') && <Badge>{t('commands.test')}</Badge>}
                  {marks.includes('migration') && <Badge tone="risk">{t('commands.migration')}</Badge>}
                </>
              )
            }
          />
        );
      })}
    </CommandList>
  );
}
