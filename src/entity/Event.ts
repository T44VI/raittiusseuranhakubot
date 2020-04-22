import { Entity, PrimaryColumn, Column } from "typeorm";
import { Category } from "..";

@Entity()
export class Event {
  @PrimaryColumn({ length: 10 })
  id: string;

  @Column({ length: 40 })
  name: string;

  @Column({ length: 200 })
  desc: string;

  @Column()
  host: number;

  @Column()
  username: string;

  @Column()
  category: Category;

  @Column()
  endTime: Date;

  @Column({ nullable: true })
  messageId: number;

  constructor(
    id: string,
    name: string,
    desc: string,
    host: number,
    username: string,
    category: Category,
    endTime: Date
  ) {
    this.id = id;
    this.name = name;
    this.desc = desc;
    this.host = host;
    this.username = username;
    this.category = category;
    this.endTime = endTime;
  }
}
