import "reflect-metadata";
import { createConnection, getRepository, getConnection } from "typeorm";

const connection = createConnection();

import { readFileSync } from "fs";
import _ from "lodash";

const MAX_HOURS = 12;
const MIN_MINUTES = 10;
const HUUTELU_CHAT_ID = Number(readFileSync("chatId.txt", "utf8").trim());

import Telegraf, { ContextMessageUpdate, Markup } from "telegraf";
import TelegrafInlineMenu from "telegraf-inline-menu";
import session from "telegraf/session";
import { Event } from "./entity/Event";
import { Admin } from "./entity/Admin";
import { Block } from "./entity/Block";

type sessionContextMessageUpdate = ContextMessageUpdate & {
  session?: { [key: string]: any };
};

class SessionVariable<T> {
  initialValue: T;
  name: string;
  constructor(initialValue: T, name: string) {
    this.initialValue = initialValue;
    this.name = name;
  }
  get(ctx: sessionContextMessageUpdate): T {
    return ctx.session && ctx.session[this.name]
      ? ctx.session[this.name]
      : this.initialValue;
  }
  set(ctx: sessionContextMessageUpdate, newVal: T) {
    if (!ctx.session) {
      ctx.session = {};
    }
    ctx.session[this.name] = newVal;
  }
}

export type Category = "Sportti" | "Pelit" | "After Work" | "Muut";

const categories: Category[] = ["Sportti", "Pelit", "After Work", "Muut"];

type EventPlan = {
  name: string;
  desc: string;
  category?: Category;
  minutesL: number;
  latestEdit: string;
};

const admin = {
  check: (id: number) =>
    getRepository(Admin)
      .createQueryBuilder("admin")
      .where("admin.id = :id", { id })
      .getMany()
      .then((a) => a.length > 0)
      .catch((e) => false),
  add: (id: number, username: string) =>
    getConnection().manager.save(new Admin(id, username)),
  remove: (id: number) =>
    getConnection()
      .createQueryBuilder()
      .delete()
      .from(Admin)
      .where("id = :id", { id })
      .execute(),
};

const blacklist = {
  check: (id: number) =>
    getRepository(Block)
      .createQueryBuilder("block")
      .where("block.id = :id", { id })
      .getMany()
      .then((a) => a.length > 0)
      .catch((e) => false),
  add: (id: number, username: string) =>
    getConnection().manager.save(new Block(id, username)),
  remove: (id: number) =>
    getConnection()
      .createQueryBuilder()
      .delete()
      .from(Block)
      .where("id = :id", { id })
      .execute(),
};

const initialEventPlan = {
  name: "",
  desc: "",
  minutesL: 0,
  latestEdit: "",
};

const eventPlan = new SessionVariable<EventPlan>(initialEventPlan, "plan");

const validate = {
  name: (str: string): string => {
    const trimmed = str.trim();
    if (trimmed.length > 40) {
      throw new Error("Liian pitkä nimi, max 40 merkkiä");
    }
    if (trimmed.length <= 0) {
      throw new Error("Liian lyhyt nimi");
    }
    return trimmed;
  },
  desc: (str: string): string => {
    const trimmed = str.trim();
    if (trimmed.length > 200) {
      throw new Error("Liian pitkä kuvaus, max 200 merkkiä");
    }
    if (trimmed.length <= 0) {
      throw new Error("Liian lyhyt kuvaus");
    }
    return trimmed;
  },
  minutesL: (str: string): number => {
    if (Number(str) + 1) {
      const num = Number(str);
      if (num > MAX_HOURS * 60) {
        throw new Error(`Et voi asettaa yli ${MAX_HOURS}h kestoa`);
      }
      if (num < MIN_MINUTES) {
        throw new Error(`Minimipituus on ${MIN_MINUTES} minuuttia`);
      }
      return Math.round(num);
    }
    if (str.includes("h")) {
      const splitted = str.split("h");
      if (splitted.length !== 2) {
        throw new Error("Invalid value");
      }
      const hours = Number(splitted[0]);
      const minutes = Number(splitted[1]);
      if (!(hours + minutes + 1)) {
        throw new Error("Invalid value");
      }
      if (minutes >= 60) {
        throw new Error("Invalid value");
      }
      if (hours > MAX_HOURS || (minutes > 0 && hours >= MAX_HOURS)) {
        throw new Error(`Et voi asettaa yli ${MAX_HOURS}h kestoa`);
      }
      const res = hours * 60 + minutes;
      if (res < MIN_MINUTES) {
        throw new Error(`Minimipituus on ${MIN_MINUTES} minuuttia`);
      }
      return Math.round(res);
    }
    const splitted = str.split(":");
    if (splitted.length !== 2) {
      throw new Error("Invalid value");
    }
    const hours = Number(splitted[0]);
    const minutes = Number(splitted[1]);
    if (!(hours + minutes + 1) || hours >= 24 || minutes >= 60) {
      throw new Error("Invalid value");
    }
    const resDate = new Date();
    resDate.setHours(hours, minutes, 0, 0);
    if (resDate.getTime() < Date.now()) {
      resDate.setDate(resDate.getDate() + 1);
    }
    const res = Math.round((resDate.getTime() - Date.now()) / 60000);
    if (res > MAX_HOURS * 60) {
      throw new Error(`Et voi asettaa yli ${MAX_HOURS}h kestoa`);
    }
    if (res < MIN_MINUTES) {
      throw new Error(`Minimipituus on ${MIN_MINUTES} minuuttia`);
    }
    return res;
  },
  all: (plan: EventPlan): boolean =>
    !!validate.name(plan.name) &&
    !!validate.desc(plan.name) &&
    plan.minutesL >= MIN_MINUTES &&
    plan.minutesL <= MAX_HOURS * 60 &&
    plan.category &&
    categories.includes(plan.category),
};

const letters = "ABCDEFGHIJKLMOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

let LastTime = 0;

const cleanTables = async (): Promise<any> => {
  if (Date.now() - 60000 > LastTime) {
    LastTime = Date.now();
    const eves = await getConnection()
      .createQueryBuilder()
      .select("event")
      .from(Event, "event")
      .where("endTime < :time", { time: new Date(Date.now()) })
      .getMany();
    return Promise.all(
      eves.map((eve) => {
        events.removeById(eve.id);
        if (eve.messageId) {
          huuteluBot.telegram.deleteMessage(HUUTELU_CHAT_ID, eve.messageId);
        }
      })
    );
  }
  return Promise.resolve();
};

const events = {
  get: () =>
    cleanTables().then(() =>
      getRepository(Event).createQueryBuilder("event").getMany()
    ),
  getByCategory: (category: string) =>
    cleanTables().then(() =>
      getRepository(Event)
        .createQueryBuilder("event")
        .where(`event.category = :category`, { category })
        .getMany()
    ),
  getById: (id: string) =>
    cleanTables().then(() =>
      getRepository(Event)
        .createQueryBuilder("event")
        .where(`event.id = :id`, { id })
        .getOne()
    ),
  getByUserId: (id: number) =>
    cleanTables().then(() =>
      getRepository(Event)
        .createQueryBuilder("event")
        .where(`event.host = :id`, { id })
        .getMany()
    ),
  add: async (ctx: sessionContextMessageUpdate, plan: EventPlan) => {
    const id = _.fill(Array(8), "a")
      .map((l) => letters[Math.floor(Math.random() * letters.length)])
      .join("");
    if (
      (await events.get()).filter((e) => e.id === id).length ||
      id.length === 0
    ) {
      throw new Error("Yritä uudelleen");
    }
    if (!validate.all(plan)) {
      throw new Error("Value error");
    }
    if (
      !ctx.callbackQuery ||
      !ctx.callbackQuery.from ||
      !ctx.callbackQuery.from.id ||
      !ctx.callbackQuery.from.id
    ) {
      throw new Error("Epäselvä lähettäjä, ota vichy!");
    }
    return getConnection().manager.save(
      new Event(
        id,
        plan.name,
        plan.desc,
        ctx.callbackQuery.from.id,
        ctx.callbackQuery.from.username,
        plan.category || "Muut",
        new Date(Date.now() + plan.minutesL * 60000)
      )
    );
  },
  removeById: (id: string) =>
    getConnection()
      .createQueryBuilder()
      .delete()
      .from(Event)
      .where("id = :id", { id })
      .execute(),
  setMessageId: (eventId: string, msgId: number) => {
    getConnection()
      .createQueryBuilder()
      .update(Event)
      .set({ messageId: msgId })
      .where("id = :id", { id: eventId })
      .execute();
  },
};

const token = readFileSync("token.txt", "utf8").trim();
const bot = new Telegraf(token);
const huuteluToken = readFileSync("token_huutelubot.txt", "utf8").trim();
const huuteluBot = new Telegraf(huuteluToken);

const categoryHeader = (ctx: sessionContextMessageUpdate) => ctx.match![1];

const eventHeader = async (
  ctx: sessionContextMessageUpdate
): Promise<string> => {
  const event = await events.getById(ctx.match![2]);
  if (!event) {
    return "Jotain meni vikaan :(";
  }
  return `${event.name}\n${
    event.desc
  }\n\nLoppumisaika: ${event.endTime.getHours()}:${
    event.endTime.getMinutes() < 10
      ? "0" + event.endTime.getMinutes()
      : event.endTime.getMinutes()
  } ${
    ctx.callbackQuery &&
    ctx.callbackQuery.from &&
    (await admin.check(ctx.callbackQuery.from.id))
      ? `\nHost: @${event.username}, ${event.host}`
      : ""
  }`;
};

const menu = new TelegrafInlineMenu(
  "*Päävalikko*\n\nSaadaksesi välittömän tiedon uusista aktiviteeteista, liity kanavalle @Raittiusseuranhuutelua"
);

const allEvents = {
  menu: new TelegrafInlineMenu("Aktiviteettikategoriat"),
  eventSubmenu: new TelegrafInlineMenu(eventHeader),
  catalogSubmenu: new TelegrafInlineMenu(categoryHeader),
};

allEvents.menu.selectSubmenu("c", categories, allEvents.catalogSubmenu, {
  textFunc: async (ctx: sessionContextMessageUpdate, key: string) => {
    const eventL = (await events.getByCategory(key)).length;
    if (!eventL) {
      return key;
    }
    return `${key} (${eventL})`;
  },
  columns: 2,
});

allEvents.catalogSubmenu.selectSubmenu(
  "e",
  (ctx) =>
    events
      .getByCategory(ctx.match![1])
      .then((eves: Event[]) => eves.map((e) => e.id)),
  allEvents.eventSubmenu,
  {
    textFunc: async (ctx: sessionContextMessageUpdate, key: string) => {
      const event = await events.getById(key);
      const minutes = Math.floor(
        (event.endTime.getTime() - Date.now()) / 60000
      );
      const time =
        minutes > 60
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}min`
          : `${minutes}min`;
      return `${event.name} (${time})`;
    },
    columns: 3,
  }
);

allEvents.eventSubmenu
  .simpleButton("Liity 🤝", "a", {
    doFunc: async (ctx) => {
      const event = await events.getById(ctx.match![2]);
      if (!event) {
        return ctx.answerCbQuery(
          "Aktiviteetti on jo loppunut tai jotain meni vikaan :("
        );
      }
      ctx.reply(`Loistavaa! Littymisohjeet löytyy @${event.username}`);
      ctx.telegram.sendMessage(
        event.host,
        `@${ctx.callbackQuery.from.username} haluaisi liittyä aktiviteettiin ${event.name}!`
      );
      ctx.answerCbQuery();
    },
  })
  .simpleButton("Poista ❌", "rem", {
    doFunc: async (ctx) => {
      const event = await events.getById(ctx.match![2]);
      if (
        !event ||
        !ctx.callbackQuery ||
        !ctx.callbackQuery.from ||
        !(await admin.check(ctx.callbackQuery.from.id))
      ) {
        return ctx.answerCbQuery(
          "Aktiviteetti on jo loppunut tai jotain meni vikaan :("
        );
      }
      try {
        await events.removeById(event.id);
        ctx.answerCbQuery("Aktiviteetti poistettu");
        ctx.telegram.sendMessage(
          event.host,
          "Järjestelmänvalvoja on poisti aktiviteettisi"
        );
        if (event.messageId) {
          huuteluBot.telegram.deleteMessage(HUUTELU_CHAT_ID, event.messageId);
        }
      } catch (e) {
        ctx.answerCbQuery(e);
      }
    },
    hide: async (ctx) =>
      !ctx.callbackQuery ||
      !ctx.callbackQuery.from ||
      !(await admin.check(ctx.callbackQuery.from.id)),
  })
  .simpleButton("Blokkaa 🚫", "blo", {
    doFunc: async (ctx) => {
      const event = await events.getById(ctx.match![2]);
      if (
        !event ||
        !ctx.callbackQuery ||
        !ctx.callbackQuery.from ||
        !(await admin.check(ctx.callbackQuery.from.id)) ||
        event.host === ctx.callbackQuery.from.id
      ) {
        return ctx.answerCbQuery(
          "Aktiviteetti on jo loppunut tai jotain meni vikaan :("
        );
      }
      try {
        await blacklist.add(event.host, event.username);
        ctx.answerCbQuery("Käyttäjä blokattu");
        ctx.telegram.sendMessage(event.host, "Järjestelmänvalvoja esti sinut");
      } catch (e) {
        ctx.answerCbQuery(e);
      }
    },
    hide: async (ctx) =>
      !ctx.callbackQuery ||
      !ctx.callbackQuery.from ||
      !(await admin.check(ctx.callbackQuery.from.id)),
  });

const newEventHeader = (ctx: sessionContextMessageUpdate) => {
  const event = eventPlan.get(ctx);
  const res: string[] = [];

  const le = event.latestEdit ? [event.latestEdit + "\n"] : [];

  if (event.name || event.desc || event.category || event.minutesL) {
    res.push("UUSI AKTIVITEETTI");
  }
  if (event.name) {
    res.push(`Nimi: ${event.name}`);
  }
  if (event.desc) {
    res.push(`Kuvaus: ${event.desc}`);
  }
  if (event.category) {
    res.push(`Kategoria: ${event.category}`);
  }
  if (event.minutesL) {
    const endDate = new Date(Date.now() + event.minutesL * 60000);
    res.push(
      `Pituus: ${
        event.minutesL >= 60 ? `${Math.floor(event.minutesL / 60)}h ` : ""
      }${event.minutesL % 60}min, - poistuu ${endDate.getHours()}:${
        endDate.getMinutes() < 10 ? "0" : ""
      }${endDate.getMinutes()}`
    );
  }

  if (res.length) {
    return le.concat(res).join("\n");
  }
  return le
    .concat(["Tervetuloa uuden aktiviteetin muodostamiseen!"])
    .join("\n");
};

const ownEventHeader = async (ctx: sessionContextMessageUpdate) => {
  const event = await events.getById(ctx.match![1]);
  if (!event) {
    return "Tapahtumaa ei löytynyt";
  }
  return `${event.name}\n${
    event.desc
  }\n\nLoppumisaika: ${event.endTime.getHours()}:${
    event.endTime.getMinutes() < 10
      ? "0" + event.endTime.getMinutes()
      : event.endTime.getMinutes()
  }`;
};

const ownEvents = {
  menu: new TelegrafInlineMenu("Omat aktiviteetit"),
  addSubmenu: new TelegrafInlineMenu(newEventHeader),
  ownEventMenu: new TelegrafInlineMenu(ownEventHeader),
};

menu.submenu("Kaikki aktiviteetit ", "a", allEvents.menu, {
  hide: async (ctx) =>
    ctx.callbackQuery &&
    ctx.callbackQuery.from.id &&
    (await blacklist.check(ctx.callbackQuery.from.id)),
});
menu.submenu(
  async (ctx: sessionContextMessageUpdate) => {
    const eventL = ctx.callbackQuery
      ? (await events.getByUserId(ctx.callbackQuery.from.id)).length
      : 0;
    return `Omat aktiviteetit${eventL ? ` (${eventL})` : ""}`;
  },
  "o",
  ownEvents.menu,
  {
    hide: async (ctx) =>
      ctx.callbackQuery &&
      ctx.callbackQuery.from.id &&
      (await blacklist.check(ctx.callbackQuery.from.id)),
  }
);

ownEvents.menu.selectSubmenu(
  "o",
  (ctx: sessionContextMessageUpdate) =>
    events
      .getByUserId(ctx.callbackQuery.from.id)
      .then((eves) => eves.map((e) => e.id)),
  ownEvents.ownEventMenu,
  {
    textFunc: (ctx: sessionContextMessageUpdate, key: string) =>
      events.getById(key).then((eve) => eve.name),
    columns: 3,
  }
);

ownEvents.menu.submenu("Lisää 🆕", "l", ownEvents.addSubmenu, {
  joinLastRow: true,
});

ownEvents.addSubmenu
  .question(
    (ctx: sessionContextMessageUpdate): string => {
      if (!eventPlan.get(ctx).name) {
        return "➡️ Aseta nimi ⬅️";
      }
      return "Muokkaa nimeä";
    },
    "nam",
    {
      uniqueIdentifier: "601",
      questionText: "💧 Aktiviteetin nimi? 💧",
      setFunc: (_ctx, key) => {
        try {
          const name = validate.name(key);
          const latestEdit = "✅ Uusi nimi asetettu!";
          const oldEventPlan = eventPlan.get(_ctx);
          eventPlan.set(_ctx, { ...oldEventPlan, name, latestEdit });
        } catch (e) {
          const latestEdit = "‼️ " + e;
          const oldEventPlan = eventPlan.get(_ctx);
          eventPlan.set(_ctx, { ...oldEventPlan, latestEdit });
        }
      },
    }
  )
  .question(
    (ctx: sessionContextMessageUpdate): string => {
      if (!eventPlan.get(ctx).desc) {
        return "➡️ Aseta kuvaus ⬅️";
      }
      return "Muokkaa kuvausta";
    },
    "des",
    {
      uniqueIdentifier: "602",
      questionText:
        "💦 Kirjoita aktiviteetille lyhyt kuvaus. Sisällytä tähän myös vaatimukset aktiviteettiin osallitumiselle 💦",
      setFunc: (_ctx, key) => {
        try {
          const desc = validate.desc(key);
          const latestEdit = "✅ Uusi kuvaus asetettu!";
          const oldEventPlan = eventPlan.get(_ctx);
          eventPlan.set(_ctx, { ...oldEventPlan, desc, latestEdit });
        } catch (e) {
          const latestEdit = "‼️ " + e;
          const oldEventPlan = eventPlan.get(_ctx);
          eventPlan.set(_ctx, { ...oldEventPlan, latestEdit });
        }
      },
      hide: (_ctx) => !eventPlan.get(_ctx).name,
    }
  )
  .select("cat", categories, {
    setFunc: (ctx, key) => {
      try {
        const latestEdit = "✅ Uusi kategoria asetettu!";
        const oldEventPlan = eventPlan.get(ctx);
        eventPlan.set(ctx, {
          ...oldEventPlan,
          category: key as Category,
          latestEdit,
        });
      } catch (e) {
        const oldEventPlan = eventPlan.get(ctx);
        eventPlan.set(ctx, {
          ...oldEventPlan,
          latestEdit: "‼️ Oops! Jotain odottamatonta tapahtui :(",
        });
      }
    },
    isSetFunc: (ctx, key) => eventPlan.get(ctx).category === key,
    hide: (_ctx) => !eventPlan.get(_ctx).desc,
    columns: 2,
  })
  .question(
    (ctx: sessionContextMessageUpdate): string => {
      if (!eventPlan.get(ctx).minutesL) {
        return "➡️ Aseta kesto ⬅️";
      }
      return "Muokkaa kestoa";
    },
    "len",
    {
      uniqueIdentifier: "603",
      questionText:
        "🚰 Ilmoita aktiviteetin kesto joko 🚰\n1. Minuutteina (vain numero)\n2. Tunteina ja minuutteina (muodossa [h]h[mm] - esim '1h20' olisi 1h 20min\n3. Lopetuskellonaikana (muodossa [HH]:[mm] - esim 9:15 tai 17:30",
      setFunc: (_ctx, key) => {
        try {
          const minutesL = validate.minutesL(key);
          const latestEdit = "✅ Uusi kesto asetettu! Muista vielä tallentaa!";
          const oldEventPlan = eventPlan.get(_ctx);
          eventPlan.set(_ctx, { ...oldEventPlan, minutesL, latestEdit });
        } catch (e) {
          const latestEdit = "‼️ " + e;
          const oldEventPlan = eventPlan.get(_ctx);
          eventPlan.set(_ctx, { ...oldEventPlan, latestEdit });
        }
      },
      hide: (_ctx) => !eventPlan.get(_ctx).category,
    }
  )
  .simpleButton("Tallenna 💾", "sav", {
    doFunc: async (ctx) => {
      try {
        const eventP = eventPlan.get(ctx);
        const event = await events.add(ctx, eventP);
        const latestEdit = `✅ Tapahtuma ${event.name} luotu!`;
        eventPlan.set(ctx, { ...initialEventPlan, latestEdit });
        ctx.answerCbQuery("Tapahtuma tallennettu");
        const msgInfo = await huuteluBot.telegram.sendMessage(
          HUUTELU_CHAT_ID,
          `Uusi tapahtuma kategoriaan ${event.category}:\n${
            event.name
          }\n\nPäättyy noin: ${event.endTime.getHours()}:${
            event.endTime.getMinutes() < 10 ? "0" : ""
          }${event.endTime.getMinutes()}\n @${bot.options.username}`
        );
        events.setMessageId(event.id, msgInfo.message_id);
      } catch (e) {
        const latestEdit = "‼️ " + e;
        const oldEventPlan = eventPlan.get(ctx);
        eventPlan.set(ctx, { ...oldEventPlan, latestEdit });
      }
    },
    setMenuAfter: true,
    hide: (ctx) => !eventPlan.get(ctx).minutesL,
  })
  .simpleButton("Tyhjennä kaikki kentät ❌", "emp", {
    doFunc: async (ctx) => {
      eventPlan.set(ctx, initialEventPlan);
      ctx.answerCbQuery("⚠️ Kentät tyhjennetty!");
    },
    setMenuAfter: true,
    hide: (ctx) => !eventPlan.get(ctx).name,
  });

ownEvents.ownEventMenu.simpleButton("Lopeta ❌", "end", {
  doFunc: async (ctx) => {
    const id = ctx.match![1];
    try {
      const event = await events.getById(id);
      await events.removeById(id);
      ctx.answerCbQuery("Aktiviteetti lopetettu");
      if (event.messageId) {
        huuteluBot.telegram.deleteMessage(HUUTELU_CHAT_ID, event.messageId);
      }
    } catch (e) {
      ctx.answerCbQuery("Jotain meni vikaan");
    }
  },
  setMenuAfter: true,
  hide: (ctx) => !events.getById(ctx.match![1]),
});

menu.submenu(
  "Käyttöohjeita ℹ️",
  "photo",
  new TelegrafInlineMenu("", {
    photo:
      "https://static.prodeko.org/media/public/2020/04/15/raittiusseuranhaku2.png",
  })
);

menu.setCommand("vichy");

bot.use(session());

bot.use(
  menu.init({
    backButtonText: "Takaisin 👈",
    mainMenuButtonText: "Päävalikkoon ↩️",
  })
);

bot.catch((error: any) => {
  console.log(
    "telegraf error",
    error.response,
    error.parameters,
    error.on || error
  );
});

huuteluBot.catch((error: any) => {
  console.log(
    "telegraf error",
    error.response,
    error.parameters,
    error.on || error
  );
});

async function startup(): Promise<void> {
  await bot.launch();
  console.log(new Date(), "Bot started as", bot.options.username);
  await huuteluBot.launch();
  console.log(new Date(), "HuuteluBot started as", huuteluBot.options.username);
}

startup();
