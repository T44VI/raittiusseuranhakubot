import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity()
export class Admin {
  @PrimaryColumn()
  id: number;

  @Column()
  username: string;

  constructor(id: number, username: string) {
    this.id = id;
    this.username = username;
  }
}
