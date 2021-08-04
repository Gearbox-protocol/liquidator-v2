import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity()
export class Faucet {
  @PrimaryColumn()
  id: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @Column()
  address: string;

  @Column({ default: "" })
  token: string;

  @Column({ name: "next_update", default: 0 })
  nextUpdate: number;

  @Column({ default: 0, type: "float" })
  total: number;
}
