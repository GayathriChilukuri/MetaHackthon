import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const demoWorkspaces=sqliteTable('demo_workspaces',{
 id:text('id').primaryKey(),state:text('state').notNull(),revision:integer('revision').notNull().default(0),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
});
export const demoAudit=sqliteTable('demo_audit',{
 id:text('id').primaryKey(),workspaceId:text('workspace_id').notNull(),at:text('at').notNull(),action:text('action').notNull(),detail:text('detail').notNull()
},table=>[index('audit_workspace_at').on(table.workspaceId,table.at)]);
export const aiUsage=sqliteTable('ai_usage',{
 key:text('key').primaryKey(),count:integer('count').notNull().default(0),lastAt:integer('last_at').notNull().default(0)
});
