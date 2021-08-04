import {MigrationInterface, QueryRunner} from "typeorm";

export class totalType1628030698996 implements MigrationInterface {
    name = 'totalType1628030698996'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "public"."faucet" DROP COLUMN "total"`);
        await queryRunner.query(`ALTER TABLE "public"."faucet" ADD "total" double precision NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "public"."faucet" DROP COLUMN "total"`);
        await queryRunner.query(`ALTER TABLE "public"."faucet" ADD "total" integer NOT NULL DEFAULT '0'`);
    }

}
