import { ExternalLink, Newspaper } from 'lucide-react';
import type { NewsItem } from '@klymon/shared-types';
import { invoke, useAsync } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { formatDate } from '../lib/utils';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

export function NewsPage(): React.JSX.Element {
  const { t } = useI18n();
  const news = useAsync<NewsItem[]>(() => invoke('news:list'), []);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('news.title')} subtitle={t('news.subtitle')} />
      {news.loading ? <Spinner label={t('common.loading')} /> : null}
      {news.error ? <Alert variant="error">{news.error}</Alert> : null}
      {!news.loading && (news.data ?? []).length === 0 ? <EmptyState icon={<Newspaper className="size-6" />} title={t('news.empty')} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {(news.data ?? []).map((item) => (
          <Card key={item.id} className="flex flex-col overflow-hidden">
            {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-40 w-full object-cover" loading="lazy" /> : null}
            <CardContent className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <Badge variant={item.category === 'launcher' ? 'default' : 'muted'}>{item.category}</Badge>
                <span className="text-[10px] text-muted-foreground">{formatDate(item.publishedAt)}</span>
              </div>
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="line-clamp-4 text-[11px] text-muted-foreground">{item.summary}</p>
              {item.url ? (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-auto self-start p-0"
                  onClick={() => void invoke('app:open-external', { url: item.url! })}
                >
                  <ExternalLink className="size-3" /> Minecraft.net
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
