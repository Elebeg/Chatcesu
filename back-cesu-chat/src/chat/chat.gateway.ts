import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedSocket } from './authenticated-socket.interface';
import { GroupService } from '../group/group.service';
import { UsersService } from '../users/users.service';

@WebSocketGateway({ cors: true })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;

    constructor(
        private readonly chatService: ChatService,
        private readonly jwtService: JwtService,
        private readonly groupService: GroupService,
        private readonly usersService: UsersService
    ) {}

    afterInit(server: Server) {}

    async handleConnection(client: AuthenticatedSocket) {
        const token = client.handshake.auth.token;
        if (!token) return client.disconnect();

        try {
            const decoded = await this.jwtService.verifyAsync(token);
            client.user = decoded;
            console.log(`Client connected: ${client.id}, User ID: ${decoded.id}`);
        } catch (error) {
            console.error('Authentication error:', error);
            client.disconnect();
        }
    }

    handleDisconnect(client: AuthenticatedSocket) {}

    @SubscribeMessage('sendMessage')
    async handleMessage(client: AuthenticatedSocket, createMessageDto: CreateMessageDto) {
        const senderId = client.user?.id;
        if (!senderId) return;

        const message = await this.chatService.createMessage(createMessageDto, senderId);
        this.server.emit('message', message);

        this.server.to(message.toString()).emit('notification', { //ENVIO DE NOTIFICAÇÃO
            title: 'Nova mensagem',
            content: `Você recebeu uma nova mensagem de ${client.user.id}`,
            timestamp: new Date(),
        });
    }

    @SubscribeMessage('joinChat')
    handleJoinChat(client: AuthenticatedSocket, userId: number) {
        client.join(userId.toString());
    }

    @SubscribeMessage('joinGroup')
    async handleJoinGroup(client: AuthenticatedSocket, groupId: number) {
        const group = await this.groupService.findGroupById(groupId);
        if (group && group.members.some(member => member.id === client.user.id)) {
            client.join(`group_${groupId}`);
            console.log(`User ${client.user.id} joined group ${groupId}`);
    
            const messages = await this.groupService.getMessagesByGroupId(groupId);
            client.emit('groupMessages', messages);  
        } else {
            client.emit('error', 'Access denied to the group');
        }
    }

    @SubscribeMessage('sendGroupMessage')
    async handleGroupMessage(client: AuthenticatedSocket, payload: { groupId: number; content: string }) {
        const { groupId, content } = payload;
        const senderId = client.user?.id;
        if (!senderId) return;
    
        const sender = await this.usersService.findById(senderId);
        if (!sender) return; 

        const groupMessage = await this.groupService.addMessageToGroup(groupId, sender, content);
        try {
            this.server.to(`group_${groupId}`).emit('groupMessage', groupMessage);
        } catch (error) {
            console.error('Erro ao enviar mensagem para o grupo:', error);
            client.emit('error', 'Failed to send message');
        }

        this.server.to(groupMessage.toString()).emit('notification', { //ENVIO DE NOTIFICAÇÃO
            title: 'Nova mensagem',
            content: `Você recebeu uma nova mensagem de ${client.user.id}`,
            timestamp: new Date(),
        });
    }    
}

