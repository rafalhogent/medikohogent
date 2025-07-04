import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Logbook } from './entities/logbook.entity';
import { Repository } from 'typeorm';
import { Log } from './entities/log.entity';
import { LogbookSyncDto, LogDto } from './dto/logbook-sync.dto';
import User from '../users/entities/user.entity';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class LogbookService {
  constructor(
    @InjectRepository(Logbook)
    private readonly logbooksRepo: Repository<Logbook>,
    @InjectRepository(Log)
    private readonly logsRepo: Repository<Log>,
  ) {}

  getLogbooksByUser(userId: number) {
    return this.logbooksRepo.find({
      where: { owner: { id: userId } },
      relations: { logs: true },
    });
  }

  async syncLogbooksByUser(syncDto: LogbookSyncDto, userId: number) {
    const clientLogbooks = plainToInstance(Logbook, syncDto.logbooks);
    try {
      const dbLogbooks = plainToInstance(
        Logbook,
        await this.logbooksRepo.find({
          relations: { logs: true },
          where: { owner: { id: userId } },
        }),
      );

      const logsToRemove: Log[] = [];
      clientLogbooks?.forEach(async (clb) => {
        const dblogbook = dbLogbooks.find((dblb) => dblb.id == clb.id);
        if (dblogbook) {
          if (clb.isDeleted && !dblogbook.isDeleted) {
            dblogbook.makeDeleted();
            logsToRemove.push(...dblogbook.logs);
          } else if (!dblogbook.isDeleted) {
            if (
              clb.updatedAt &&
              dblogbook.updatedAt &&
              clb.updatedAt > dblogbook.updatedAt
            ) {
              dblogbook.update(clb);
            }

            clb.logs.forEach((cl) => {
              const dblog = dblogbook.logs.find((l) => l.id == cl.id);
              if (dblog) {
                if (!dblog.isDeleted && cl.isDeleted) {
                  dblog.makeDeleted();
                } else if (!dblog.isDeleted) {
                  if (
                    dblog.updatedAt &&
                    cl.updatedAt &&
                    dblog.updatedAt < cl.updatedAt
                  ) {
                    dblog.update(cl as LogDto);
                  }
                }
              } else {
                dblogbook.logs.push(cl);
              }
            });
          }
        } else {
          clb.owner = { id: userId } as User;
          dbLogbooks.push(clb);
        }
      });

      const savedLogbooks = await this.logbooksRepo.save(dbLogbooks);
      if (logsToRemove.length) await this.logsRepo.remove(logsToRemove);
      return savedLogbooks;
    } catch (error) {
      throw new ConflictException('Failed to synchronize logbooks');
    }
  }
}
