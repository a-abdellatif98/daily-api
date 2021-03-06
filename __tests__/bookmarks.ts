import { FastifyInstance } from 'fastify';
import { Connection, getConnection } from 'typeorm';
import { ApolloServer } from 'apollo-server-fastify';
import {
  ApolloServerTestClient,
  createTestClient,
} from 'apollo-server-testing';
import * as request from 'supertest';
import * as _ from 'lodash';

import createApolloServer from '../src/apollo';
import { Context } from '../src/Context';
import {
  authorizeRequest,
  MockContext,
  saveFixtures,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import appFunc from '../src';
import {
  Bookmark,
  Post,
  PostTag,
  Source,
  SourceDisplay,
  View,
} from '../src/entity';
import { sourcesFixture } from './fixture/source';
import { postsFixture, postTagsFixture } from './fixture/post';
import { sourceDisplaysFixture } from './fixture/sourceDisplay';

let app: FastifyInstance;
let con: Connection;
let server: ApolloServer;
let client: ApolloServerTestClient;
let loggedUser: string = null;

const now = new Date();
const bookmarksFixture = [
  {
    userId: '1',
    postId: 'p3',
    createdAt: new Date(now.getTime() - 1000),
  },
  {
    userId: '1',
    postId: 'p1',
    createdAt: new Date(now.getTime() - 2000),
  },
  {
    userId: '1',
    postId: 'p5',
    createdAt: new Date(now.getTime() - 3000),
  },
];

beforeAll(async () => {
  con = await getConnection();
  server = await createApolloServer({
    context: (): Context => new MockContext(con, loggedUser),
    playground: false,
  });
  client = createTestClient(server);
  app = await appFunc();
  return app.ready();
});

beforeEach(async () => {
  loggedUser = null;

  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, SourceDisplay, sourceDisplaysFixture);
  await saveFixtures(con, Post, postsFixture);
  await saveFixtures(con, PostTag, postTagsFixture);
});

afterAll(() => app.close());

describe('mutation addBookmarks', () => {
  const MUTATION = `
  mutation AddBookmarks($data: AddBookmarkInput!) {
  addBookmarks(data: $data) {
    _
  }
}`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { data: { postIds: [] } },
      },
      'UNAUTHENTICATED',
    ));

  it('should add new bookmarks', async () => {
    loggedUser = '1';
    const res = await client.mutate({
      mutation: MUTATION,
      variables: { data: { postIds: ['p1', 'p3'] } },
    });
    expect(res.errors).toBeFalsy();
    const actual = await con
      .getRepository(Bookmark)
      .find({ where: { userId: loggedUser }, select: ['postId', 'userId'] });
    expect(actual).toMatchSnapshot();
  });

  it('should ignore conflicts', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Bookmark);
    await repo.save(repo.create({ postId: 'p1', userId: loggedUser }));
    const res = await client.mutate({
      mutation: MUTATION,
      variables: { data: { postIds: ['p1', 'p3'] } },
    });
    expect(res.errors).toBeFalsy();
    const actual = await repo.find({
      where: { userId: loggedUser },
      select: ['postId', 'userId'],
    });
    expect(actual).toMatchSnapshot();
  });
});

describe('mutation removeBookmark', () => {
  const MUTATION = (id: string): string => `
  mutation RemoveBookmark {
  removeBookmark(id: "${id}") {
    _
  }
}`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION('2'),
      },
      'UNAUTHENTICATED',
    ));

  it('should remove existing bookmark', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Bookmark);
    await repo.save(repo.create({ postId: 'p1', userId: loggedUser }));
    const res = await client.mutate({
      mutation: MUTATION('p1'),
    });
    expect(res.errors).toBeFalsy();
    const actual = await repo.find({
      where: { userId: loggedUser },
      select: ['postId', 'userId'],
    });
    expect(actual.length).toEqual(0);
  });

  it('should ignore remove non-existing bookmark', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Bookmark);
    const res = await client.mutate({
      mutation: MUTATION('p1'),
    });
    expect(res.errors).toBeFalsy();
    const actual = await repo.find({
      where: { userId: loggedUser },
      select: ['postId', 'userId'],
    });
    expect(actual.length).toEqual(0);
  });
});

describe('query bookmarks', () => {
  const QUERY = (
    unreadOnly?: boolean,
    now = new Date(),
    first = 10,
  ): string => `{
  bookmarksFeed(now: "${now.toISOString()}", first: ${first}${
    unreadOnly ? ', unreadOnly: true' : ''
  }) {
    pageInfo {
      endCursor
      hasNextPage
    }
    edges {
      node {
        id
        source {
          id
          name
          image
          public
        }
        tags
      }
    }
  }
}`;

  it('should not authorize when not logged in', () =>
    testQueryErrorCode(
      client,
      {
        query: QUERY(),
      },
      'UNAUTHENTICATED',
    ));

  it('should return bookmarks ordered by time', async () => {
    loggedUser = '1';
    await saveFixtures(con, Bookmark, bookmarksFixture);
    const res = await client.query({ query: QUERY(false, now, 2) });
    expect(res.data).toMatchSnapshot();
  });

  it('should return unread bookmarks only', async () => {
    loggedUser = '1';
    await saveFixtures(con, Bookmark, bookmarksFixture);
    await con.getRepository(View).save([{ userId: '1', postId: 'p3' }]);
    const res = await client.query({ query: QUERY(true, now, 2) });
    expect(res.data).toMatchSnapshot();
  });
});

describe('compatibility routes', () => {
  describe('POST /posts/bookmarks', () => {
    it('should return bad request when no body is provided', () =>
      authorizeRequest(request(app.server).post('/v1/posts/bookmarks')).expect(
        400,
      ));

    it('should add new bookmarks', async () => {
      await authorizeRequest(request(app.server).post('/v1/posts/bookmarks'))
        .send(['p1', 'p3'])
        .expect(204);
      const actual = await con.getRepository(Bookmark).find({
        where: { userId: '1' },
        select: ['postId', 'userId'],
      });
      expect(actual).toMatchSnapshot();
    });
  });

  describe('POST /posts/:id/bookmarks', () => {
    it('should remove existing bookmark', async () => {
      const repo = con.getRepository(Bookmark);
      await repo.save(repo.create({ postId: 'p1', userId: '1' }));
      await authorizeRequest(
        request(app.server).delete('/v1/posts/p1/bookmark'),
      )
        .send()
        .expect(204);
      const actual = await repo.find({
        where: { userId: '1' },
        select: ['postId', 'userId'],
      });
      expect(actual.length).toEqual(0);
    });
  });

  describe('GET /posts/bookmarks', () => {
    it('should return bookmarks ordered by time', async () => {
      await saveFixtures(con, Bookmark, bookmarksFixture);
      const res = await authorizeRequest(
        request(app.server).get('/v1/posts/bookmarks'),
      )
        .query({ latest: now, pageSize: 2, page: 0 })
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });
  });
});
