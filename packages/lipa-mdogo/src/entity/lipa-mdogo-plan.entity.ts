import { Channel, Order, VendureEntity } from '@vendure/core';
import type { DeepPartial } from '@vendure/core';
import { Column, Entity, ManyToOne } from 'typeorm';

export type LipaMdogoPlanState = 'Active' | 'Completed' | 'Missed';

@Entity()
export class LipaMdogoPlan extends VendureEntity {
  constructor(input?: DeepPartial<LipaMdogoPlan>) {
    super(input);
  }

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order!: Order;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  channel!: Channel;

  @Column()
  deposit!: number;

  @Column({ type: Date })
  deadline!: Date;

  @Column('simple-json')
  reminderDaysBefore!: number[];

  @Column('simple-json')
  remindersSent!: number[];

  @Column({ type: 'varchar' })
  state!: LipaMdogoPlanState;
}
