import { Event } from "./../entities/starknet/Event";
import { Context } from "./../context";
import { Indexer, RealmEvent } from "./../types";
import { BigNumber } from "ethers";
import { hash } from "starknet";
import { OrderType } from "@prisma/client";

type ContractEventHandler = {
  name: string;
  handle: (event: Event) => Promise<boolean>;
};

function selectorHash(selector: string) {
  return BigNumber.from(selector).toHexString();
}

export default class BaseContractIndexer implements Indexer<Event> {
  protected context: Context;
  protected addresses: string[];
  private handlers: { [select: string]: ContractEventHandler };

  constructor(context: Context, address: string) {
    this.context = context;
    this.handlers = {};
    this.addresses = [address];
  }

  contracts(): string[] {
    return this.addresses;
  }

  on(name: string, handle: (event: Event) => Promise<boolean>) {
    this.handlers[selectorHash(hash.getSelectorFromName(name))] = {
      name,
      handle
    };
  }

  eventName(selector: string): string {
    return this.handlers[selectorHash(selector)]?.name ?? "";
  }

  async index(events: Event[]): Promise<void> {
    let indexed: string[] = [];
    try {
      for (const event of events) {
        const eventId = event.eventId;
        const handlerObject = this.handlers[selectorHash(event.keys[0])];
        if (handlerObject) {
          await handlerObject.handle(event);
        }
        indexed.push(eventId);
      }
    } catch (e) {
      console.error(e);
    }
    await this.context.prisma.event.updateMany({
      where: { eventId: { in: indexed } },
      data: { status: 2 }
    });
    return;
  }

  async lastIndexId(): Promise<string> {
    const event = await this.context.prisma.event.findFirst({
      where: {
        contract: { in: this.contracts() },
        status: 2
      },
      orderBy: {
        eventId: "desc"
      }
    });
    return event?.eventId ?? "";
  }

  async saveRealmHistory({
    realmId,
    eventId,
    eventType,
    account,
    data,
    timestamp,
    transactionHash
  }: RealmEvent): Promise<void> {
    let realmOwner = account ?? "";
    // if (!realmOwner) {
    const realm = await this.context.prisma.realm.findFirst({
      where: { realmId }
    });
    let realmName = "";
    let realmOrder = undefined;
    if (!realmOwner) {
      realmOwner = realm?.settledOwner || realm?.ownerL2 || "";
    }
    realmName = realm?.name ?? "";
    realmOrder = (realm?.orderType as OrderType) ?? undefined;

    await this.context.prisma.realmHistory.upsert({
      where: {
        eventId_eventType: { eventId: eventId, eventType: eventType }
      },
      update: { realmId, realmOwner, data, timestamp, realmName, realmOrder },
      create: {
        eventId,
        eventType,
        realmId,
        realmOwner,
        data,
        timestamp,
        transactionHash,
        realmName,
        realmOrder
      }
    });
  }
}
