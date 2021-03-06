import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { SearchOptions } from '@algolia/client-search';
import { PostTag } from './PostTag';
import { Source } from './Source';
import { getPostsIndex, trackSearch } from '../common';

@Entity()
export class Post {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ nullable: true })
  publishedAt?: Date;

  @Column({ default: () => 'now()' })
  @Index('IDX_post_createdAt', { synchronize: false })
  createdAt: Date;

  @Column({ type: 'text' })
  @Index()
  sourceId: string;

  @ManyToOne(() => Source, (source) => source.posts, {
    lazy: true,
    onDelete: 'CASCADE',
  })
  source: Promise<Source>;

  @Column({ type: 'text' })
  @Index()
  url: string;

  @Column({ type: 'text', nullable: true })
  @Index()
  canonicalUrl?: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  image?: string;

  @Column({ type: 'float', nullable: true })
  ratio?: number;

  @Column({ type: 'text', nullable: true })
  placeholder?: string;

  @Column({ default: false })
  tweeted: boolean;

  @Column({ default: 0 })
  views: number;

  @Column({ type: 'integer', default: 0 })
  @Index('IDX_post_score', { synchronize: false })
  score: number;

  @Column({ type: 'text', nullable: true })
  siteTwitter?: string;

  @Column({ type: 'text', nullable: true })
  creatorTwitter?: string;

  @Column({ nullable: true })
  readTime?: number;

  @OneToMany(() => PostTag, (tag) => tag.post, { lazy: true })
  tags: Promise<PostTag[]>;
}

export interface SearchPostsResult {
  id: string;
  title: string;
  highlight?: string;
}

export interface AlgoliaSearchResult {
  title: string;
  _highlightResult?: { title: { value: string } };
}

export const searchPosts = async (
  query: string,
  opts: SearchOptions,
  trackingId: string,
  ip: string,
): Promise<SearchPostsResult[]> => {
  const res = await getPostsIndex().search<AlgoliaSearchResult>(query, {
    headers: trackSearch(trackingId, ip),
    ...opts,
  });
  return res.hits.map(
    (hit): SearchPostsResult => ({
      id: hit.objectID,
      title: hit.title,
      highlight: hit?._highlightResult?.title.value,
    }),
  );
};
