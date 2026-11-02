import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { computeDueAt, slaPolicyFor, type BusinessCalendar } from "@/domain/sla";
import type {
  AffectedScope,
  Priority,
  TicketCategory,
  TicketStatus,
  TicketType,
} from "@/domain/tickets";
import { normalizeText } from "@/domain/similarity";
import * as schema from "./schema";

/**
 * Synthetic demo data. Every insert is "on conflict do nothing", so running the
 * seed on each deployment never duplicates rows nor rewinds real changes.
 */

type SeedUser = {
  email: string;
  name: string;
  role: "employee" | "analyst";
  department: string;
  supportLevel?: string;
  deviceOs?: string;
};

const SEED_USERS: SeedUser[] = [
  {
    email: "ana.souza@nexo.com.br",
    name: "Ana Souza",
    role: "employee",
    department: "Financeiro",
    deviceOs: "Windows 11",
  },
  {
    email: "carla.mendes@nexo.com.br",
    name: "Carla Mendes",
    role: "employee",
    department: "Comercial",
    deviceOs: "Windows 10",
  },
  {
    email: "bruno.tavares@nexo.com.br",
    name: "Bruno Tavares",
    role: "employee",
    department: "Operações",
    deviceOs: "Windows 11",
  },
  {
    email: "diego.ramos@nexo.com.br",
    name: "Diego Ramos",
    role: "employee",
    department: "Marketing",
    deviceOs: "macOS 15",
  },
  {
    email: "elisa.prado@nexo.com.br",
    name: "Elisa Prado",
    role: "employee",
    department: "Jurídico",
    deviceOs: "Windows 10",
  },
  {
    email: "fabio.nunes@nexo.com.br",
    name: "Fábio Nunes",
    role: "employee",
    department: "Logística",
    deviceOs: "Windows 11",
  },
  {
    email: "gabriela.rocha@nexo.com.br",
    name: "Gabriela Rocha",
    role: "employee",
    department: "Recursos Humanos",
    deviceOs: "Windows 11",
  },
  {
    email: "rafael.lima@nexo.com.br",
    name: "Rafael Lima",
    role: "analyst",
    department: "Service Desk",
    supportLevel: "Suporte N2",
  },
  {
    email: "marina.costa@nexo.com.br",
    name: "Marina Costa",
    role: "analyst",
    department: "Service Desk",
    supportLevel: "Suporte N1",
  },
];

type SeedTicket = {
  number: string;
  requester: string;
  type: TicketType;
  category: TicketCategory;
  subcategory?: string;
  priority: Priority;
  scope: AffectedScope;
  status: TicketStatus;
  title: string;
  description: string;
  /** Hours before seeding. */
  createdHoursAgo: number;
  /** Hours before seeding of the latest support update (starts the SLA window). */
  updatedHoursAgo: number;
  resolution?: string;
};

const SEED_TICKETS: SeedTicket[] = [
  {
    number: "INC-20311",
    requester: "ana.souza@nexo.com.br",
    type: "INC",
    category: "Hardware",
    subcategory: "Notebook",
    priority: "media",
    scope: "self",
    status: "waiting_analyst",
    title: "Notebook lento após atualização do Windows",
    description:
      "Lentidão geral desde a atualização do Windows. Reiniciar e rodar o diagnóstico da central não resolveu.",
    createdHoursAgo: 24 * 7,
    updatedHoursAgo: 24 * 6,
  },
  {
    number: "INC-20298",
    requester: "ana.souza@nexo.com.br",
    type: "INC",
    category: "Acesso",
    subcategory: "SharePoint",
    priority: "media",
    scope: "self",
    status: "in_progress",
    title: "Sem acesso à pasta Financeiro no SharePoint",
    description:
      "Desde a migração do site, a pasta Financeiro retorna 'acesso negado'. Consigo trabalhar com cópias enviadas por e-mail.",
    createdHoursAgo: 30,
    updatedHoursAgo: 20,
  },
  {
    number: "REQ-10442",
    requester: "ana.souza@nexo.com.br",
    type: "REQ",
    category: "Hardware",
    subcategory: "Monitor",
    priority: "baixa",
    scope: "self",
    status: "approved",
    title: "Segundo monitor para home office",
    description: "Pedido de um segundo monitor para o home office. Aprovado pela gestora.",
    createdHoursAgo: 24 * 9,
    updatedHoursAgo: 24 * 2,
  },
  {
    number: "INC-20150",
    requester: "ana.souza@nexo.com.br",
    type: "INC",
    category: "Acesso",
    subcategory: "SAP",
    priority: "media",
    scope: "self",
    status: "resolved",
    title: "Senha do SAP bloqueada",
    description: "A senha do SAP foi bloqueada após tentativas erradas.",
    createdHoursAgo: 24 * 5,
    updatedHoursAgo: 24 * 4,
    resolution: "Senha desbloqueada e redefinida pelo Suporte N1.",
  },
  {
    number: "INC-19877",
    requester: "ana.souza@nexo.com.br",
    type: "INC",
    category: "E-mail",
    subcategory: "Outlook mobile",
    priority: "media",
    scope: "self",
    status: "closed",
    title: "Outlook não sincroniza no celular",
    description: "O aplicativo do Outlook parou de sincronizar os e-mails no celular.",
    createdHoursAgo: 24 * 60,
    updatedHoursAgo: 24 * 58,
    resolution: "Conta reconfigurada com o novo método de autenticação.",
  },
  {
    number: "INC-20480",
    requester: "carla.mendes@nexo.com.br",
    type: "INC",
    category: "Hardware",
    subcategory: "Impressora",
    priority: "media",
    scope: "team",
    status: "open",
    title: "Impressora do 3º andar não imprime",
    description:
      "A impressora do 3º andar mostra 'offline'. A equipe está usando a impressora do 2º andar.",
    createdHoursAgo: 5,
    updatedHoursAgo: 5,
  },
  {
    number: "REQ-10451",
    requester: "carla.mendes@nexo.com.br",
    type: "REQ",
    category: "Acesso",
    subcategory: "SAP",
    priority: "alta",
    scope: "self",
    status: "open",
    title: "Acesso ao módulo de vendas do SAP",
    description: "Preciso de acesso ao módulo SD do SAP para lançar pedidos de um cliente hoje.",
    createdHoursAgo: 1,
    updatedHoursAgo: 1,
  },
  {
    number: "INC-20501",
    requester: "bruno.tavares@nexo.com.br",
    type: "INC",
    category: "Software",
    subcategory: "Teams",
    priority: "media",
    scope: "self",
    status: "in_progress",
    title: "Teams cai durante chamadas de vídeo",
    description:
      "As chamadas de vídeo no Teams caem depois de alguns minutos. Pelo celular funciona.",
    createdHoursAgo: 26,
    updatedHoursAgo: 8,
  },
];

type SeedArticle = {
  id: string;
  title: string;
  category: TicketCategory;
  platforms: string[];
  keywords: string;
  body: string;
};

const SEED_ARTICLES: SeedArticle[] = [
  {
    id: "KB-001",
    title: "VPN com erro 809 no Windows 10",
    category: "Rede e VPN",
    platforms: ["Windows 10"],
    keywords: "vpn 809 conexão remota home office cliente vpn não conecta",
    body:
      "Erro 809 ao conectar na VPN: reinstale o cliente de VPN pelo Portal de Softwares e reinicie o computador. " +
      "Vale apenas para Windows 10. No Windows 11 essa correção não funciona: abra um chamado de Rede e VPN.",
  },
  {
    id: "KB-002",
    title: "Horário de atendimento do service desk",
    category: "Outros",
    platforms: [],
    keywords: "horário atendimento plantão service desk suporte expediente telefone ramal 4000",
    body:
      "O service desk atende de segunda a sexta, das 8h às 18h (horário de Brasília). Chamados críticos têm plantão 24 horas. " +
      "Por telefone, ligue no ramal 4000.",
  },
  {
    id: "KB-003",
    title: "Senha da rede expirada ou conta bloqueada",
    category: "Acesso",
    platforms: [],
    keywords: "senha rede expirada bloqueada conta login windows esqueci redefinir",
    body:
      "Se a senha da rede expirou ou a conta foi bloqueada, use o autoatendimento de senhas no Portal do Colaborador " +
      "a partir de outro dispositivo, validando pelo celular cadastrado. Após redefinir, aguarde 15 minutos e entre novamente. " +
      "Sem celular cadastrado, abra um chamado de Acesso.",
  },
  {
    id: "KB-004",
    title: "Senha do SAP bloqueada",
    category: "Acesso",
    platforms: [],
    keywords: "sap senha bloqueada desbloqueio usuário sap",
    body:
      "O SAP não usa a senha da rede. Depois de 5 tentativas erradas o usuário é bloqueado e só o service desk pode desbloquear: " +
      "abra um chamado de Acesso informando o seu usuário SAP.",
  },
  {
    id: "KB-005",
    title: "Instalar programas pelo Portal de Softwares",
    category: "Software",
    platforms: ["Windows 10", "Windows 11"],
    keywords: "instalar programa software portal catálogo licença aplicativo",
    body:
      "Programas homologados ficam no Portal de Softwares e podem ser instalados sem chamado. " +
      "Programas fora do catálogo ou que exigem licença paga precisam de uma requisição de Software com a justificativa do gestor.",
  },
  {
    id: "KB-006",
    title: "Outlook não sincroniza no celular",
    category: "E-mail",
    platforms: ["Android", "iOS"],
    keywords: "outlook celular sincroniza email e-mail mobile autenticador mfa",
    body:
      "Remova a conta do aplicativo Outlook, atualize o app e adicione a conta novamente aprovando o acesso no autenticador. " +
      "Se o erro continuar, abra um chamado de E-mail informando o modelo do celular.",
  },
  {
    id: "KB-007",
    title: "Sem internet no Wi-Fi corporativo",
    category: "Rede e VPN",
    platforms: [],
    keywords: "wifi wi-fi internet rede sem conexão nexo-corp cabo",
    body:
      "No escritório, conecte-se à rede Nexo-Corp com o usuário e a senha da rede. Se não conectar, esqueça a rede e conecte de novo. " +
      "Se ninguém do andar tiver internet, é uma falha coletiva: avise o service desk para abrir um chamado crítico.",
  },
  {
    id: "KB-008",
    title: "Computador lento",
    category: "Hardware",
    platforms: ["Windows 10", "Windows 11"],
    keywords: "lento lentidão travando computador notebook desempenho atualização",
    body:
      "Reinicie o computador, instale as atualizações pendentes e rode o diagnóstico Nexo Check no Portal de Softwares. " +
      "Se a lentidão continuar, abra um chamado de Hardware informando o resultado do diagnóstico.",
  },
  {
    id: "KB-009",
    title: "Pedir equipamento (monitor, teclado, headset)",
    category: "Hardware",
    platforms: [],
    keywords: "monitor teclado mouse headset equipamento pedir solicitar home office periférico",
    body:
      "Equipamentos são pedidos por uma requisição de Hardware. O pedido precisa da aprovação do gestor; depois de aprovado, " +
      "a entrega leva até 5 dias úteis.",
  },
  {
    id: "KB-010",
    title: "Assuntos fora da TI",
    category: "Outros",
    platforms: [],
    keywords:
      "férias salário holerite benefícios reembolso limpeza manutenção ar condicionado crachá rh financeiro facilities",
    body:
      "Férias, holerite e benefícios são tratados pelo RH no Portal do Colaborador. Reembolsos ficam com o Financeiro. " +
      "Limpeza, manutenção predial e crachás ficam com Facilities pelo ramal 3000.",
  },
];

export async function seedDatabase(
  db: NodePgDatabase<typeof schema>,
  calendar: BusinessCalendar,
  now = new Date(),
): Promise<{ users: number; tickets: number; articles: number }> {
  await db
    .insert(schema.users)
    .values(
      SEED_USERS.map((user) => ({
        email: user.email,
        name: user.name,
        role: user.role,
        department: user.department,
        supportLevel: user.supportLevel ?? null,
        deviceOs: user.deviceOs ?? null,
      })),
    )
    .onConflictDoNothing();

  const userRows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users);
  const userIdByEmail = new Map(userRows.map((row) => [row.email.toLowerCase(), row.id]));

  let insertedTickets = 0;
  for (const ticket of SEED_TICKETS) {
    const requesterId = userIdByEmail.get(ticket.requester);
    if (!requesterId) throw new Error(`Seed: usuário ${ticket.requester} não encontrado`);
    const createdAt = new Date(now.getTime() - ticket.createdHoursAgo * 3_600_000);
    const updatedAt = new Date(now.getTime() - ticket.updatedHoursAgo * 3_600_000);
    const policy = slaPolicyFor(ticket.priority, calendar);
    const closed = ticket.status === "resolved" || ticket.status === "closed";
    const inserted = await db
      .insert(schema.tickets)
      .values({
        number: ticket.number,
        requesterId,
        type: ticket.type,
        category: ticket.category,
        subcategory: ticket.subcategory ?? null,
        priority: ticket.priority,
        scope: ticket.scope,
        status: ticket.status,
        title: ticket.title,
        description: ticket.description,
        slaStartedAt: updatedAt,
        slaDueAt: computeDueAt(updatedAt, policy, calendar),
        slaPolicy: { ...policy, timeZone: calendar.timeZone },
        resolvedAt: closed ? updatedAt : null,
        resolution: ticket.resolution ?? null,
        createdAt,
        updatedAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.tickets.id });
    const row = inserted[0];
    if (!row) continue;
    insertedTickets += 1;
    await db.insert(schema.ticketEvents).values([
      {
        ticketId: row.id,
        actorKind: "system",
        action: "created",
        toStatus: "open",
        createdAt,
        note: "Chamado de exemplo",
      },
      ...(ticket.status !== "open"
        ? [
            {
              ticketId: row.id,
              actorKind: "system" as const,
              action: "status_changed",
              fromStatus: "open" as const,
              toStatus: ticket.status,
              createdAt: updatedAt,
              note: ticket.resolution ?? null,
            },
          ]
        : []),
    ]);
  }

  // Seeds use numbers below the sequence start; keep the sequences ahead anyway.
  await db.execute(
    sql`select setval('inc_number_seq', greatest((select coalesce(max(substring(number from 5)::int), 0) from tickets where type = 'INC') + 1, nextval('inc_number_seq')), false)`,
  );
  await db.execute(
    sql`select setval('req_number_seq', greatest((select coalesce(max(substring(number from 5)::int), 0) from tickets where type = 'REQ') + 1, nextval('req_number_seq')), false)`,
  );

  await db
    .insert(schema.knowledgeArticles)
    .values(
      SEED_ARTICLES.map((article) => ({
        ...article,
        searchText: normalizeText(`${article.title} ${article.keywords} ${article.body}`),
      })),
    )
    .onConflictDoNothing();

  return { users: SEED_USERS.length, tickets: insertedTickets, articles: SEED_ARTICLES.length };
}
