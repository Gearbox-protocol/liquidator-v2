import {MigrationInterface, QueryRunner} from "typeorm";

export class faucet1628027590497 implements MigrationInterface {
    name = 'faucet1628027590497'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "faucet" ("id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "address" character varying NOT NULL, "token" character varying NOT NULL DEFAULT '', "next_update" integer NOT NULL DEFAULT '0', "total" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_30dd77a5c903913146a359d2a4f" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "faucet"`);
    }

}
